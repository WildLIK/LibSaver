// ComicInfo 2.0 fields, in schema order. Unknown fields are omitted.
function makeComicInfo(title, chapters, pageCount, info = {}) {
  const clean = value => String(value ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/g, '');
  const escape = value => clean(value).replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[char]));
  const names = value => Array.isArray(value) ? [...new Set(value.filter(item=>typeof item==='string'&&item.trim()).map(item=>item.trim()))].join(', ') : '';
  const fields = {Title:title,Series:title,Number:chapters.length===1?chapters[0].number:'',
    Summary:info.summary,Notes:'LibSaver. Сохранённые главы: '+chapters.map(chapter=>`Том ${chapter.volume}, глава ${chapter.number}`).join('; ')+'.',
    Writer:names(info.writers),Penciller:names(info.artists),Publisher:names(info.publishers),Genre:names(info.genres),
    Web:info.sourceUrl,PageCount:pageCount};
  return '<?xml version="1.0" encoding="utf-8"?>\n<ComicInfo>\n'+Object.entries(fields)
    .filter(([,value])=>value!=null&&value!=='').map(([name,value])=>`  <${name}>${escape(value)}</${name}>`).join('\n')+'\n</ComicInfo>\n';
}
