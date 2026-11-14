#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use base64::{engine::general_purpose::STANDARD, Engine};
use std::{fs, io::{Cursor, Write}, path::Path};
use symphonia::core::{audio::SampleBuffer, codecs::DecoderOptions, errors::Error, formats::FormatOptions, io::MediaSourceStream, meta::MetadataOptions, probe::Hint};
use tauri::Manager;

fn atomic_write(path: &Path, data: &[u8]) -> Result<(), String> {
    let parent = path.parent().filter(|p| !p.as_os_str().is_empty()).unwrap_or(Path::new("."));
    let mut file = tempfile::NamedTempFile::new_in(parent).map_err(|e| e.to_string())?;
    file.write_all(data).map_err(|e| e.to_string())?;
    file.as_file().sync_all().map_err(|e| e.to_string())?;
    file.persist(path).map_err(|e| e.error.to_string())?;
    Ok(())
}
fn check_extension(path: &str, ext: &str) -> Result<(), String> {
    if Path::new(path).extension().and_then(|s| s.to_str()).map(|s| s.eq_ignore_ascii_case(ext)) != Some(true) { return Err(format!("Gunakan ekstensi .{ext}")); }
    Ok(())
}
#[tauri::command]
async fn read_audio(path: String) -> Result<tauri::ipc::Response, String> {
    tauri::async_runtime::spawn_blocking(move || {
        if fs::metadata(&path).map_err(|e| e.to_string())?.len() > 100 * 1024 * 1024 { return Err("Batas audio 100 MB per berkas".into()); }
        Ok(tauri::ipc::Response::new(fs::read(path).map_err(|e| e.to_string())?))
    }).await.map_err(|e| e.to_string())?
}
#[tauri::command]
async fn read_project(path: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        check_extension(&path, "kura")?;
        if fs::metadata(&path).map_err(|e| e.to_string())?.len() > 400 * 1024 * 1024 { return Err("Proyek melebihi 400 MB".into()); }
        fs::read_to_string(path).map_err(|e| e.to_string())
    }).await.map_err(|e| e.to_string())?
}
#[tauri::command]
async fn write_project(path: String, content: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        check_extension(&path, "kura")?;
        if content.len() > 400 * 1024 * 1024 { return Err("Proyek melebihi 400 MB".into()); }
        let doc: serde_json::Value = serde_json::from_str(&content).map_err(|e| e.to_string())?;
        if doc["format"] != "kuraudio" || ![1, 2, 3, 4].iter().any(|version| doc["version"] == *version) { return Err("Format proyek tidak valid".into()); }
        atomic_write(Path::new(&path), content.as_bytes())
    }).await.map_err(|e| e.to_string())?
}
#[tauri::command]
async fn export_mp3(path: String, bytes_base64: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        check_extension(&path, "mp3")?;
        if bytes_base64.len() > 64 * 1024 * 1024 { return Err("Berkas MP3 melebihi batas ukuran".into()); }
        let bytes = STANDARD.decode(bytes_base64).map_err(|e| e.to_string())?;
        if bytes.len() < 4 || !(bytes.starts_with(b"ID3") || (bytes[0] == 0xff && bytes[1] & 0xe0 == 0xe0)) { return Err("Data MP3 tidak valid".into()); }
        atomic_write(Path::new(&path), &bytes)
    }).await.map_err(|e| e.to_string())?
}
fn within_render_limit(byte_len: usize, sample_rate: u32) -> bool { byte_len <= sample_rate as usize * 2 * 4 * (900 + 12) }
fn wav_pcm(bytes: &[u8], sample_rate: u32, channels: u16, bits: u16) -> Result<Vec<u8>, String> {
    if ![44100, 48000].contains(&sample_rate) || channels != 2 || ![16, 24].contains(&bits) || !bytes.len().is_multiple_of(8) || bytes.is_empty() { return Err("Parameter audio tidak valid".into()); }
    if !within_render_limit(bytes.len(), sample_rate) { return Err("Batas ekspor 15 menit ditambah ekor efek".into()); }
    let mut output = Cursor::new(Vec::new());
    {
        let mut writer = hound::WavWriter::new(&mut output, hound::WavSpec { channels, sample_rate, bits_per_sample: bits, sample_format: hound::SampleFormat::Int }).map_err(|e| e.to_string())?;
        for chunk in bytes.chunks_exact(4) {
            let sample = f32::from_le_bytes(chunk.try_into().unwrap());
            if !sample.is_finite() { return Err("Audio berisi nilai bukan angka".into()); }
            let sample = sample.clamp(-1.0, 1.0);
            if bits == 16 { writer.write_sample((sample * if sample < 0.0 { 32768.0 } else { 32767.0 }).round() as i16).map_err(|e| e.to_string())?; }
            else { writer.write_sample((sample * if sample < 0.0 { 8388608.0 } else { 8388607.0 }).round() as i32).map_err(|e| e.to_string())?; }
        }
        writer.finalize().map_err(|e| e.to_string())?;
    }
    Ok(output.into_inner())
}
#[tauri::command]
async fn export_wav(path: String, pcm_base64: String, sample_rate: u32, bits: u16) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        check_extension(&path, "wav")?;
        let bytes = STANDARD.decode(pcm_base64).map_err(|e| e.to_string())?;
        let wav = wav_pcm(&bytes, sample_rate, 2, bits)?;
        atomic_write(Path::new(&path), &wav)
    }).await.map_err(|e| e.to_string())?
}
fn decode_to_wav(bytes: Vec<u8>) -> Result<Vec<u8>, String> {
    let mss = MediaSourceStream::new(Box::new(Cursor::new(bytes)), Default::default());
    let probed = symphonia::default::get_probe().format(&Hint::new(), mss, &FormatOptions::default(), &MetadataOptions::default()).map_err(|e| e.to_string())?;
    let mut format = probed.format;
    let track = format.default_track().ok_or("Tidak ada track audio")?;
    let id = track.id;
    let params = track.codec_params.clone();
    let mut decoder = symphonia::default::get_codecs().make(&params, &DecoderOptions::default()).map_err(|e| e.to_string())?;
    let mut output = Cursor::new(Vec::new());
    let rate = params.sample_rate.ok_or("Sample rate tidak tersedia")?;
    let channels = params.channels.ok_or("Kanal tidak tersedia")?.count() as u16;
    let mut samples = 0usize;
    {
        let mut writer = hound::WavWriter::new(&mut output, hound::WavSpec { channels, sample_rate: rate, bits_per_sample: 32, sample_format: hound::SampleFormat::Float }).map_err(|e| e.to_string())?;
        loop {
            let packet = match format.next_packet() { Ok(p) => p, Err(Error::IoError(e)) if e.kind() == std::io::ErrorKind::UnexpectedEof => break, Err(e) => return Err(e.to_string()) };
            if packet.track_id() != id { continue; }
            let decoded = decoder.decode(&packet).map_err(|e| e.to_string())?;
            let mut buffer = SampleBuffer::<f32>::new(decoded.capacity() as u64, *decoded.spec());
            buffer.copy_interleaved_ref(decoded);
            samples += buffer.samples().len();
            if samples * 4 > 256 * 1024 * 1024 { return Err("Audio terdekode melebihi batas memori 256 MB".into()); }
            for &sample in buffer.samples() { writer.write_sample(sample).map_err(|e| e.to_string())?; }
        }
        writer.finalize().map_err(|e| e.to_string())?;
    }
    Ok(output.into_inner())
}
#[tauri::command]
async fn decode_audio(bytes_base64: String) -> Result<tauri::ipc::Response, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let bytes = STANDARD.decode(bytes_base64).map_err(|e| e.to_string())?;
        if bytes.len() > 100 * 1024 * 1024 { return Err("Batas audio 100 MB".into()); }
        Ok(tauri::ipc::Response::new(decode_to_wav(bytes)?))
    }).await.map_err(|e| e.to_string())?
}
fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| { if let Some(window) = app.get_webview_window("main") { let _ = window.unminimize(); let _ = window.set_focus(); } }))
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![read_audio, read_project, write_project, export_wav, export_mp3, decode_audio])
        .run(tauri::generate_context!()).expect("KurAudio gagal dijalankan");
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test] fn project_versions_roundtrip_without_damaging_existing_file() {
        let dir = tempfile::tempdir().unwrap(); let path = dir.path().join("versions.kura");
        for version in [1, 2, 3, 4] {
            let content = serde_json::json!({"format":"kuraudio","version":version,"project":{"name":"Presisi","clips":[{"automation":[{"time":0,"gain":0.8}],"loudnessGain":0.75,"locked":true,"groupId":"group","effects":{"enabled":{"reverb":false},"reverb":40}}]},"media":[]}).to_string();
            tauri::async_runtime::block_on(write_project(path.to_string_lossy().into(), content.clone())).unwrap();
            assert_eq!(fs::read_to_string(&path).unwrap(), content);
        }
        let original = fs::read(&path).unwrap();
        for version in [0, 5] {
            let content = serde_json::json!({"format":"kuraudio","version":version}).to_string();
            assert!(tauri::async_runtime::block_on(write_project(path.to_string_lossy().into(), content)).is_err());
            assert_eq!(fs::read(&path).unwrap(), original);
        }
    }
    #[test] fn render_limit_includes_effect_tails() {
        for rate in [44100, 48000] {
            assert!(within_render_limit(rate as usize * 8 * 900, rate));
            assert!(within_render_limit(rate as usize * 8 * 912, rate));
            assert!(!within_render_limit(rate as usize * 8 * 913, rate));
        }
    }
    #[test] fn wav_roundtrip_and_clamp() {
        for bits in [16, 24] {
            let pcm: Vec<u8> = [-2.0f32, 2.0, -0.25, 0.25].iter().flat_map(|s| s.to_le_bytes()).collect();
            let result = wav_pcm(&pcm, 48000, 2, bits).unwrap();
            let mut reader = hound::WavReader::new(Cursor::new(result)).unwrap();
            assert_eq!(reader.spec().bits_per_sample, bits);
            assert_eq!(reader.duration(), 2);
            let samples: Vec<i32> = reader.samples::<i32>().map(Result::unwrap).collect();
            assert_eq!(samples[0], -(1 << (bits - 1))); assert_eq!(samples[1], (1 << (bits - 1)) - 1);
        }
    }
    #[test] fn invalid_pcm_is_rejected() {
        assert!(wav_pcm(&[0], 48000, 2, 16).is_err());
        assert!(wav_pcm(&[0; 8], 48000, 2, 32).is_err());
        assert!(wav_pcm(&[0; 8], 22050, 2, 16).is_err());
        assert!(wav_pcm(&f32::NAN.to_le_bytes().repeat(2), 48000, 2, 16).is_err());
    }
    #[test] fn writes_replace_atomically() {
        let dir = tempfile::tempdir().unwrap(); let path = dir.path().join("test.kura");
        atomic_write(&path, b"first").unwrap(); atomic_write(&path, b"second").unwrap();
        assert_eq!(fs::read(&path).unwrap(), b"second");
    }
    #[test] fn fallback_decodes_wav() {
        let wav = wav_pcm(&[0; 800], 48000, 2, 24).unwrap();
        let decoded = decode_to_wav(wav).unwrap(); let r = hound::WavReader::new(Cursor::new(decoded)).unwrap();
        assert_eq!(r.spec().sample_format, hound::SampleFormat::Float); assert_eq!(r.duration(), 100);
    }
}
