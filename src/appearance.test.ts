import {describe,it,expect} from 'vitest';
import {resolveAppearance} from './appearance';
describe('application appearance resolution',()=>{
  it.each([['light',false,'light'],['light',true,'light'],['dark',false,'dark'],['dark',true,'dark'],['system',false,'light'],['system',true,'dark']] as const)('resolves %s with OS dark=%s to %s',(choice,dark,expected)=>{expect(resolveAppearance(choice,dark)).toBe(expected);});
});
