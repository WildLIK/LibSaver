// This separate script also reports a missing or unparsable popup.js.
(() => {
  const $=id=>document.getElementById(id);
  let started=false, connected=false;
  function failure(text) {
    document.body.dataset.phase='error';document.body.dataset.loading='false';
    $('phase').textContent='Ошибка';$('meterLabel').hidden=true;
    $('percent').hidden=false;$('percent').textContent='ERROR';
    $('progressBar').removeAttribute('aria-valuenow');
    $('progressBar').setAttribute('aria-valuetext','Ошибка запуска расширения');
    $('found').textContent='Не удалось запустить расширение';
    $('status').textContent='Обновите расширение на странице browser://extensions и откройте окно снова.';
    $('log').textContent+='\n'+text;
    document.querySelector('.log-panel').open=true;
    for(const id of ['start','pauseJob','stop'])$(id).disabled=true;
    $('refresh').disabled=false;
  }
  document.body.dataset.phase='inspect';document.body.dataset.loading='true';
  document.body.dataset.hasTitle='false';
  $('bookTitle').textContent='Откройте тайтл на сайте Lib';$('bookTitle').classList.add('is-placeholder');
  $('phase').textContent='Поиск';$('found').textContent='Подключаюсь к расширению…';
  $('count').textContent='Подключение к браузеру';$('status').textContent='Ожидаю ответ фонового процесса…';
  $('meterLabel').hidden=false;$('meterLabel').textContent='ПОИСК';$('percent').hidden=true;
  $('start').disabled=true;$('refresh').disabled=false;
  $('refresh').onclick=()=>chrome.runtime.reload();
  $('log').textContent='Подключение к фоновому процессу расширения…';
  const watchdog=setTimeout(()=>{
    if(!connected)failure(started?'Фоновый процесс не ответил за 12 секунд.':'Основной скрипт popup.js не запустился. Проверьте, что все файлы расширения обновлены вместе.');
  },12000);
  window.wildlBoot={started(){started=true;},connected(){connected=true;clearTimeout(watchdog);}};
  window.addEventListener('error',event=>{
    if(event.target?.tagName==='SCRIPT')failure('Не удалось загрузить '+event.target.src.split('/').pop());
    else if(event.error || event.message)failure('Ошибка интерфейса: '+event.message+(event.lineno?' (строка '+event.lineno+')':''));
  },true);
  window.addEventListener('unhandledrejection',event=>failure('Ошибка запуска: '+(event.reason?.message||String(event.reason))));
})();
