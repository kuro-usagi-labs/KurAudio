export function BrandMark({size=24}:{size?:number}){
 return <svg className="brand-mark" width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true"><path d="M7 8v16M12 4v24M17 11v10M25 6l-8 10 8 10" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/><circle className="brand-mark-dot" cx="27" cy="29" r="1.8" fill="currentColor"/></svg>;
}
