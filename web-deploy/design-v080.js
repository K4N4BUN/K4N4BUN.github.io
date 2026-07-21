(() => {
  'use strict';
  const $=(s,r=document)=>r.querySelector(s), $$=(s,r=document)=>[...r.querySelectorAll(s)];
  const labels={home:'ホーム',household:'取引',calendar:'予定',register:'資産',settings:'その他'};
  const wait=()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
  function titleOf(card){return card.querySelector('h2,h3')?.textContent.trim()||''}
  function segment(root, items, apply){
    const nav=document.createElement('div');nav.className='zy-segmented';nav.setAttribute('role','tablist');
    items.forEach((x,i)=>{const b=document.createElement('button');b.type='button';b.className='btn btn-small'+(i===0?' active':'');b.textContent=x.label;b.dataset.mode=x.key;b.onclick=()=>{$$('button',nav).forEach(y=>y.classList.toggle('active',y===b));apply(x.key)};nav.appendChild(b)});
    root.prepend(nav);apply(items[0].key);return nav;
  }
  function setCards(cards, predicate){cards.forEach(c=>c.classList.toggle('zy-hidden-by-mode',!predicate(c,titleOf(c))))}
  function upgradeTabs(){
    const nav=$('.tabs'); if(!nav)return;
    const order=['home','household','calendar','register','settings'];
    order.forEach(k=>{const b=$(`.tab[data-view="${k}"]`,nav);if(b){b.textContent=labels[k];nav.appendChild(b)}});
    $('header h1').textContent='残高予報';
    $('.subtitle').textContent='今日の資金状況、取引、予定、資産を一体管理します。';
  }
  function upgradeHome(){
    const root=$('#view-home'); if(!root||root.dataset.upgraded)return;root.dataset.upgraded='1';
    const quick=document.createElement('article');quick.className='card';quick.innerHTML=`<div class="section-head"><div><h2>クイック操作</h2><p class="small">日常操作をここから開始します。</p></div></div><div class="zy-quick-grid"><button class="btn btn-primary" data-action="add-ledger-expense">支出</button><button class="btn" data-action="add-ledger-income">収入</button><button class="btn" data-action="open-transfer">振替</button><button class="btn" data-action="zy-add-plan">予定</button><button class="btn" data-action="zy-receipt">レシート</button><button class="btn" data-action="zy-voice">音声入力</button></div>`;
    root.insertBefore(quick,root.querySelector('.metrics'));
    const explain=document.createElement('article');explain.className='card';explain.innerHTML='<div class="section-head"><div><h2>予報の内訳</h2><p class="small">現在残高から最低残高までの主要な増減要因です。</p></div></div><div id="zyForecastExplanation" class="list"></div>';
    root.querySelector('.two-col>div.grid')?.insertBefore(explain,root.querySelector('.two-col>div.grid')?.children[2]||null);
    let lastForecastExplanation="";
    const update=()=>{const el=$('#zyForecastExplanation');if(!el)return;const values=[['現在の保有残高',$('#assetTotal')?.textContent],['今すぐ使える金額',$('#safeNow')?.textContent],['予測期間の最低残高',$('#lowestBalance')?.textContent],['今月の支出',$('#householdExpense')?.textContent],['今月の収入',$('#householdIncome')?.textContent]];const next=values.map(([a,b])=>`<div class="list-row"><span>${a}</span><strong>${b||'—'}</strong></div>`).join('');if(next!==lastForecastExplanation){lastForecastExplanation=next;el.innerHTML=next;}};
    const observer=new MutationObserver(records=>{if(records.every(r=>r.target.closest?.('#zyForecastExplanation')))return;update();});
    observer.observe(document.body,{subtree:true,childList:true,characterData:true});update();
  }
  function upgradeTransactions(){
    const root=$('#view-household');if(!root||root.dataset.upgraded)return;root.dataset.upgraded='1';
    const cards=$$('article.card',root);const map={
      list:t=>/取引履歴/.test(t),
      analysis:t=>/前月|固定費|カテゴリ別|支払方法別|カード利用済み/.test(t),
      reconcile:t=>/照合|予定から実績/.test(t),
      summary:t=>/残高予報との連携/.test(t)
    };
    segment(root,[{key:'list',label:'一覧'},{key:'analysis',label:'分析'},{key:'reconcile',label:'照合'},{key:'summary',label:'概要'}],mode=>{
      root.classList.toggle('zy-transaction-mode-summary',mode==='summary');
      cards.forEach(c=>{const t=titleOf(c);const always=c.id==='v14QuickEntry'||c.closest('.overview-metrics,.metrics');const show=always?mode==='summary':map[mode](t);c.classList.toggle('zy-hidden-by-mode',!show)});
      $('.household-toolbar',root)?.classList.toggle('zy-hidden-by-mode',mode!=='list');
    });
    const h=$('h2',root);if(h)h.textContent='取引';
  }
  function upgradeCalendar(){
    const root=$('#view-calendar');if(!root||root.dataset.upgraded)return;root.dataset.upgraded='1';
    const cards=$$('article.card',root);
    segment(root,[{key:'calendar',label:'カレンダー'},{key:'list',label:'一覧'},{key:'funding',label:'資金繰り'}],mode=>setCards(cards,(c,t)=>mode==='calendar'?(/日別集計/.test(t)||c===cards[0]):mode==='list'?/入出金一覧/.test(t):/入出金一覧|日別集計/.test(t)));
    const action=document.createElement('div');action.className='quick-actions';action.innerHTML='<button class="btn btn-primary" data-action="zy-add-plan">＋予定</button><button class="btn" data-action="add-recurring">定期予定</button>';root.insertBefore(action,root.children[1]);
  }
  function upgradeAssets(){
    const root=$('#view-register');if(!root||root.dataset.upgraded)return;root.dataset.upgraded='1';
    const cards=$$('article.card',root);cards.forEach(c=>{const h=$('h2',c);if(!h)return;if(h.textContent==='保有残高')h.textContent='口座・現金・電子マネー';if(h.textContent==='毎月の入出金')h.textContent='定期予定';if(h.textContent==='一度だけの入出金')h.textContent='単発予定';if(h.textContent==='登録済みの資金移動')h.textContent='資金移動履歴'});
    segment(root,[{key:'accounts',label:'口座'},{key:'cards',label:'カード'},{key:'loans',label:'ローン'},{key:'transfer',label:'資金移動'},{key:'plans',label:'予定'}],mode=>setCards(cards,(c,t)=>({accounts:/口座・現金/,cards:/クレジット/,loans:/リボ・ローン/,transfer:/資金移動・チャージ|資金移動履歴/,plans:/定期予定|単発予定/})[mode].test(t)));
  }
  function upgradeSettings(){
    const root=$('#view-settings');if(!root||root.dataset.upgraded)return;root.dataset.upgraded='1';
    const cards=$$('article.card',root);const search=document.createElement('div');search.className='zy-settings-search';search.innerHTML='<input id="zySettingsSearch" type="search" placeholder="設定を検索" aria-label="設定を検索">';root.prepend(search);
    const host=document.createElement('div');host.id='zySettingsGroups';root.insertBefore(host,root.querySelector('.two-col'));const original=root.querySelector('.two-col');
    const groups=[
      ['analysis','分析・家計簿',/基本設定|家計簿設定|カテゴリ予算|定型入力|サブカテゴリ|店名|定期購読|営業日|ホーム表示/],
      ['tools','ツール',/月間締め|ローン|予定・実績/],
      ['data','データ保護',/バックアップ|暗号化|スナップショット|年度アーカイブ|CSV取込|CSV取込形式/],
      ['sync','共有・同期',/クラウド|課金/],
      ['security','通知・セキュリティ・表示',/通知|PIN|画面保護|表示・アクセシビリティ/],
      ['info','アプリ情報',/アプリ更新|アプリとして利用|データとプライバシー|計算仕様/],
      ['dev','開発・診断',/診断|会計ログ|保存状況|実機確認|初期設定・デモ|カード請求照合/]
    ];
    groups.forEach(([key,label,re],i)=>{const d=document.createElement('details');d.className='zy-settings-group '+(key==='dev'?'zy-dev-only':'');d.open=i===0;d.innerHTML=`<summary>${label}</summary><div class="zy-settings-group-body"></div>`;const body=$('.zy-settings-group-body',d);cards.filter(c=>re.test(titleOf(c))).forEach(c=>body.appendChild(c));if(body.children.length)host.appendChild(d)});
    const leftovers=cards.filter(c=>!c.closest('.zy-settings-group'));if(leftovers.length){const d=document.createElement('details');d.className='zy-settings-group';d.innerHTML='<summary>その他の設定</summary><div class="zy-settings-group-body"></div>';leftovers.forEach(c=>$('.zy-settings-group-body',d).appendChild(c));host.appendChild(d)}
    original?.remove();
    const devToggle=document.createElement('label');devToggle.className='card';devToggle.innerHTML='<input id="zyDeveloperMode" type="checkbox" style="width:auto;margin-right:8px">開発者モードを表示';host.appendChild(devToggle);$('#zyDeveloperMode').onchange=e=>root.classList.toggle('zy-developer-enabled',e.target.checked);
    $('#zySettingsSearch').oninput=e=>{const q=e.target.value.trim().toLowerCase();$$('.zy-settings-group',host).forEach(g=>{const hit=!q||g.textContent.toLowerCase().includes(q);g.hidden=!hit;if(q&&hit)g.open=true})};
  }
  function addPlan(){
    if(typeof openModal!=='function')return;
    openModal('予定を追加',`<div class="zy-quick-grid"><button class="btn btn-primary" id="zyPlanOnce">単発予定</button><button class="btn" id="zyPlanRecurring">定期予定</button><button class="btn" id="zyPlanCard">カード支払い</button><button class="btn" id="zyPlanLoan">ローン返済</button></div><p class="small" style="margin-top:12px">単発・定期を同じ入口から登録します。</p>`);
    $('#zyPlanOnce').onclick=()=>{closeModal();document.querySelector('[data-action="add-oneoff"]')?.click()};
    $('#zyPlanRecurring').onclick=()=>{closeModal();document.querySelector('[data-action="add-recurring"]')?.click()};
    $('#zyPlanCard').onclick=()=>{closeModal();document.querySelector('[data-action="add-card"]')?.click()};
    $('#zyPlanLoan').onclick=()=>{closeModal();document.querySelector('[data-action="add-financing"]')?.click()};
  }
  function receipt(){
    if(typeof openModal!=='function')return;openModal('レシートから登録','<p class="small">レシート画像を選択し、確認しながら支出へ登録します。</p><input id="zyReceiptFile" type="file" accept="image/*" capture="environment"><div id="zyReceiptPreview" style="margin-top:10px"></div><button class="btn btn-primary" id="zyReceiptContinue" type="button" disabled>支出入力へ</button>');
    $('#zyReceiptFile').onchange=e=>{const f=e.target.files?.[0];if(!f)return;const url=URL.createObjectURL(f);$('#zyReceiptPreview').innerHTML=`<img src="${url}" alt="レシートプレビュー" style="max-width:100%;max-height:320px;border-radius:12px">`;$('#zyReceiptContinue').disabled=false};$('#zyReceiptContinue').onclick=()=>{closeModal();document.querySelector('[data-action="add-ledger-expense"]')?.click()};
  }
  function voice(){
    if(typeof openModal!=='function')return;const SR=window.SpeechRecognition||window.webkitSpeechRecognition;openModal('音声入力',`<p class="small">例：「コンビニで1200円、食費」</p><textarea id="zyVoiceText" rows="4" placeholder="認識結果"></textarea><div class="row-actions" style="margin-top:8px"><button class="btn btn-primary" id="zyVoiceStart" ${SR?'':'disabled'}>音声認識を開始</button><button class="btn" id="zyVoiceContinue">支出入力へ</button></div>${SR?'':'<p class="small">このブラウザは音声認識APIに対応していません。</p>'}`);if(SR)$('#zyVoiceStart').onclick=()=>{const r=new SR();r.lang='ja-JP';r.onresult=e=>$('#zyVoiceText').value=e.results[0][0].transcript;r.start()};$('#zyVoiceContinue').onclick=()=>{closeModal();document.querySelector('[data-action="add-ledger-expense"]')?.click()};
  }
  function upgradeQuickSheet(){const s=$('#quickSheet .quick-sheet-panel');if(!s)return;s.querySelector('h2').textContent='追加';const close=s.querySelector('.close-sheet');[['予定','zy-add-plan'],['レシート','zy-receipt'],['音声入力','zy-voice']].forEach(([l,a])=>{const b=document.createElement('button');b.className='btn';b.type='button';b.dataset.action=a;b.textContent=l;s.insertBefore(b,close)})}
  document.addEventListener('click',e=>{const a=e.target.closest('[data-action]')?.dataset.action;if(a==='zy-add-plan'){e.preventDefault();addPlan()}if(a==='zy-receipt'){e.preventDefault();receipt()}if(a==='zy-voice'){e.preventDefault();voice()}},true);
  async function init(){await wait();upgradeTabs();upgradeHome();upgradeTransactions();upgradeCalendar();upgradeAssets();upgradeSettings();upgradeQuickSheet();document.body.dataset.designVersion='0.8.0'}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
