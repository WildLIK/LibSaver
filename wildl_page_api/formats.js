function xmlText(value) {
  return esc(String(value??'').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g,''));
}
function chapterLabel(chapter) {
  return `Том ${chapter.volume} Глава ${chapter.number}${chapter.name?' - '+chapter.name:''}`;
}
// A small common representation preserves paragraph and inline formatting.
function bookBlocks(chapter) {
  const doc=new DOMParser().parseFromString(chapter.html||'','text/html'),blocks=[];
  let runs=[];
  const flush=(heading=0)=>{if(runs.some(run=>run.text.trim()))blocks.push({runs,heading});runs=[];};
  function visit(node,format={}) {
    if(node.nodeType===3){runs.push({...format,text:node.textContent});return;}
    if(node.nodeType!==1)return;
    const tag=node.tagName.toLowerCase();if(['script','style','img','iframe','object'].includes(tag))return;
    if(tag==='br'){runs.push({...format,text:'\n'});return;}
    const block=['p','div','blockquote','pre','li','h1','h2','h3','h4','h5','h6'].includes(tag);
    if(block)flush();
    if(tag==='li')runs.push({text:node.parentElement?.tagName==='OL'?`${[...node.parentElement.children].indexOf(node)+1}. `:'• '});
    const next={...format,bold:format.bold||['b','strong'].includes(tag),italic:format.italic||['i','em'].includes(tag),
      strike:format.strike||['s','strike'].includes(tag),code:format.code||['code','pre'].includes(tag)};
    for(const child of node.childNodes)visit(child,next);
    if(block)flush(/^h\d$/.test(tag)?Number(tag[1]):0);
  }
  for(const child of doc.body.childNodes)visit(child);flush();
  return blocks.length?blocks:String(chapter.text||'').split(/\n\s*\n/).filter(text=>text.trim()).map(text=>({runs:[{text}],heading:0}));
}
function makeFb2(title,chapters,note='') {
  function inline(run){let text=xmlText(run.text).replace(/\n/g,' ');if(run.code)text=`<code>${text}</code>`;
    if(run.strike)text=`<strikethrough>${text}</strikethrough>`;if(run.italic)text=`<emphasis>${text}</emphasis>`;if(run.bold)text=`<strong>${text}</strong>`;return text;}
  const sections=chapters.map((chapter,index)=>`<section id="chapter${index+1}"><title><p>${xmlText(chapterLabel(chapter))}</p></title>${bookBlocks(chapter)
    .map(block=>`<p>${block.heading?'<strong>':''}${block.runs.map(inline).join('')}${block.heading?'</strong>':''}</p>`).join('')}</section>`).join('');
  const day=new Date().toISOString().slice(0,10);
  const content=`<?xml version="1.0" encoding="UTF-8"?><FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0" xmlns:l="http://www.w3.org/1999/xlink"><description><title-info><genre>other</genre><author><nickname>Автор не указан</nickname></author><book-title>${xmlText(title)}</book-title>${note?`<annotation>${note.split('\n').map(line=>`<p>${xmlText(line)}</p>`).join('')}</annotation>`:''}<lang>ru</lang></title-info><document-info><author><nickname>WildL Downloader</nickname></author><program-used>WildL Downloader 2.0</program-used><date value="${day}">${day}</date><id>wildl-${crypto.randomUUID()}</id><version>1.0</version></document-info></description><body><title><p>${xmlText(title)}</p></title>${sections}</body></FictionBook>`;
  return new Blob([content],{type:'application/x-fictionbook+xml;charset=utf-8'});
}
function makeDocx(title,chapters,note='') {
  const ns='http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  function runXml(run){const props=[run.bold?'<w:b/>':'',run.italic?'<w:i/>':'',run.strike?'<w:strike/>':'',run.code?'<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/>':''].join('');
    return `<w:r>${props?`<w:rPr>${props}</w:rPr>`:''}${run.text.split('\n').map((line,index)=>`${index?'<w:br/>':''}<w:t xml:space="preserve">${xmlText(line)}</w:t>`).join('')}</w:r>`;}
  function paragraph(runs,style='',breakBefore=false){return `<w:p>${style||breakBefore?`<w:pPr>${style?`<w:pStyle w:val="${style}"/>`:''}${breakBefore?'<w:pageBreakBefore/>':''}</w:pPr>`:''}${runs.map(runXml).join('')}</w:p>`;}
  let body=paragraph([{text:title}],'Title');
  if(note)for(const text of note.split('\n'))body+=paragraph([{text}]);
  chapters.forEach((chapter,index)=>{body+=paragraph([{text:chapterLabel(chapter)}],'Heading1',index>0);
    for(const block of bookBlocks(chapter))body+=paragraph(block.runs,block.heading?'Heading2':'');});
  const styles=`<?xml version="1.0" encoding="UTF-8"?><w:styles xmlns:w="${ns}"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:cs="Times New Roman"/><w:color w:val="000000"/><w:sz w:val="24"/><w:lang w:val="ru-RU"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="300" w:lineRule="auto"/><w:widowControl/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style><w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:after="280"/></w:pPr><w:rPr><w:color w:val="000000"/><w:sz w:val="40"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:pPr><w:keepNext/><w:outlineLvl w:val="0"/><w:spacing w:before="240" w:after="180"/></w:pPr><w:rPr><w:b/><w:color w:val="000000"/><w:sz w:val="32"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:pPr><w:keepNext/><w:outlineLvl w:val="1"/><w:spacing w:before="180" w:after="120"/></w:pPr><w:rPr><w:b/><w:color w:val="000000"/><w:sz w:val="28"/></w:rPr></w:style></w:styles>`;
  const rels='<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">';
  const files=[
    {name:'[Content_Types].xml',data:'<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/></Types>'},
    {name:'_rels/.rels',data:rels+'<Relationship Id="document" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'},
    {name:'word/_rels/document.xml.rels',data:rels+'<Relationship Id="styles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="footer" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/></Relationships>'},
    {name:'word/styles.xml',data:styles},
    {name:'word/footer1.xml',data:`<?xml version="1.0" encoding="UTF-8"?><w:ftr xmlns:w="${ns}"><w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:fldSimple w:instr="PAGE"><w:r><w:t>1</w:t></w:r></w:fldSimple></w:p></w:ftr>`},
    {name:'word/document.xml',data:`<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="${ns}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body>${body}<w:sectPr><w:footerReference w:type="default" r:id="footer"/><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="567" w:footer="567"/></w:sectPr></w:body></w:document>`}
  ];
  return zipCompact(files,'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
}
let pdfFontBytes;
async function makePdf(title,chapters,note='') {
  const {PDFDocument,rgb}=PDFLib,doc=await PDFDocument.create();doc.registerFontkit(fontkit);
  pdfFontBytes ||= fetch(chrome.runtime.getURL('vendor/NotoSerif-Regular.ttf')).then(async response=>{if(!response.ok)throw new Error('Не найден шрифт PDF.');return response.arrayBuffer();});
  const font=await doc.embedFont(await pdfFontBytes,{subset:true});
  const characters=new Set(font.getCharacterSet());
  const unsupported=[...new Set([...title+note+chapters.map(chapter=>chapterLabel(chapter)+chapter.text).join('')].filter(char=>!/[\s]/.test(char)&&!characters.has(char.codePointAt(0))))];
  if(unsupported.length)throw new Error('Шрифт PDF не поддерживает символы: '+unsupported.slice(0,8).join(' ')+' . Выберите FB2 или DOCX для сохранения полного текста.');
  doc.setTitle(title);doc.setCreator('WildL Downloader 2.0');doc.setLanguage('ru-RU');
  const width=595.28,height=841.89,margin=54,lineWidth=width-2*margin;let page,y;
  function newPage(){page=doc.addPage([width,height]);y=height-margin;}
  function wrap(text,size){const lines=[];let line='';for(const word of text.trim().split(/\s+/u)){
    const candidate=line?line+' '+word:word;if(font.widthOfTextAtSize(candidate,size)<=lineWidth){line=candidate;continue;}
    if(line){lines.push(line);line='';}
    for(const char of word){if(line&&font.widthOfTextAtSize(line+char,size)>lineWidth){lines.push(line);line='';}line+=char;}
  }if(line)lines.push(line);return lines;}
  function paragraph(text,size=11.5,heading=false){const leading=size*1.5,lines=wrap(text,size);if(!lines.length)return;
    if(heading&&y-margin<(lines.length+2)*leading)newPage();let cursor=0;
    while(cursor<lines.length){let available=Math.floor((y-margin)/leading);if(available<Math.min(2,lines.length-cursor)){newPage();available=Math.floor((y-margin)/leading);}
      let count=Math.min(available,lines.length-cursor);if(lines.length-cursor-count===1&&count>2)count--;
      for(let i=0;i<count;i++){page.drawText(lines[cursor++],{x:margin,y:y-size,size,font,color:rgb(0,0,0)});y-=leading;}
      if(cursor<lines.length)newPage();
    }y-=heading?12:7;}
  newPage();paragraph(title,20,true);if(note)for(const line of note.split('\n'))paragraph(line,10);
  chapters.forEach((chapter,index)=>{if(index)newPage();paragraph(chapterLabel(chapter),15,true);
    for(const block of bookBlocks(chapter))paragraph(block.runs.map(run=>run.text).join(''),block.heading?13:11.5,!!block.heading);});
  doc.getPages().forEach((page,index)=>{const text=String(index+1);page.drawText(text,{x:(width-font.widthOfTextAtSize(text,9))/2,y:28,size:9,font,color:rgb(.3,.3,.3)});});
  return new Blob([await doc.save()],{type:'application/pdf'});
}
// RAR 5 stored files: no proprietary compression or native helper is needed.
function makeCbr(files) {
  const vint=value=>{const bytes=[];do{const byte=value%128;value=Math.floor(value/128);bytes.push(byte|(value?128:0));}while(value);return bytes;};
  const header=body=>{const payload=new Uint8Array([...vint(body.length),...body]);return new Uint8Array([...u32(crc32(payload)),...payload]);};
  const chunks=[new Uint8Array([0x52,0x61,0x72,0x21,0x1a,0x07,0x01,0]),header([1,0,0])];
  for(const file of files){const name=enc(file.name),data=typeof file.data==='string'?enc(file.data):file.data;
    chunks.push(header([2,2,...vint(data.length),4,...vint(data.length),0,...u32(crc32(data)),0,1,...vint(name.length),...name]),data);}
  chunks.push(header([5,0,0]));return new Blob(chunks,{type:'application/vnd.comicbook-rar'});
}
