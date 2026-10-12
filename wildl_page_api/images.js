async function compactImage(image){
  if(['gif','avif'].includes(image.extension))return image;
  let bitmap;
  try{
    bitmap=await createImageBitmap(new Blob([image.bytes]));const canvas=document.createElement('canvas');
    canvas.width=bitmap.width;canvas.height=bitmap.height;canvas.getContext('2d').drawImage(bitmap,0,0);
    const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/webp',0.82));
    if(blob?.type==='image/webp'&&blob.size<image.bytes.length)return {bytes:new Uint8Array(await blob.arrayBuffer()),extension:'webp'};
  }catch{}finally{bitmap?.close();}
  return image;
}

async function formatImage(image,format='jpg'){
  if(format==='original'||image.extension===format)return image;
  const mime={jpg:'image/jpeg',png:'image/png',webp:'image/webp'}[format];
  if(!mime)throw new Error('Не поддерживается формат страницы: '+format);
  let bitmap;
  try{
    bitmap=await createImageBitmap(new Blob([image.bytes]));const canvas=document.createElement('canvas');canvas.width=bitmap.width;canvas.height=bitmap.height;
    const context=canvas.getContext('2d');if(!context)throw new Error('Не удалось создать изображение.');
    if(format==='jpg'){context.fillStyle='#fff';context.fillRect(0,0,canvas.width,canvas.height);}
    context.drawImage(bitmap,0,0);
    const blob=await new Promise(resolve=>canvas.toBlob(resolve,mime,format==='jpg'?.95:.9));
    if(!blob||blob.type!==mime)throw new Error('Браузер не смог сохранить выбранный формат.');
    return {bytes:new Uint8Array(await blob.arrayBuffer()),extension:format};
  }catch(error){throw new Error('Не удалось преобразовать страницу в '+format.toUpperCase()+': '+error.message);}
  finally{bitmap?.close();}
}
