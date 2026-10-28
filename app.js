const STORES=['BİM','A101','ŞOK','CarrefourSA','Migros','Hakmar','Seç Market','Bizim Toptan'];
const STORE_CODES={'BİM':'Bİ','A101':'A1','ŞOK':'Ş','CarrefourSA':'CS','Migros':'Mİ','Hakmar':'HK','Seç Market':'SÇ','Bizim Toptan':'BT'};
function dateOffset(n){const d=new Date();d.setDate(d.getDate()+n);return d.toISOString().slice(0,10)}
let campaigns=[], submissions=[], notifications=[], markets=[], branches=[], branchAssignments=[], managedProfiles=[], activeView='dashboard', submissionFilter='Tümü', deferredInstall=null, selectedPhoto=null, campaignExampleFile=null, currentProfile=null, supabaseClient=null, notificationTimer=null, editingCampaignId=null, storesSearch='', storesMarketFilter='all', reportFollowupFilter='all', reportFollowupPage=1, reportStaffFilter='all', campaignDateFrom='', campaignDateTo='', campaignMarketFilter='all', assignmentSyncWarning='';
const knownNotificationIds=new Set();
const PUSH_VAPID_PUBLIC_KEY='BHFv9MCpxSFR8s970cG3I_AshCs6ShTpDWCDEiB7Ae7_pv93y4ETXE-Fzp20_Xs2_bSpMJklFGiO65PgzW2IQU8';
const $=s=>document.querySelector(s);const $$=s=>[...document.querySelectorAll(s)];
function save(){ /* Supabase is the source of truth; no localStorage writes. */ }
function esc(s=''){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function fmtDate(s){if(!s)return '—';return new Date(s+'T12:00:00').toLocaleDateString('tr-TR',{day:'2-digit',month:'short',year:'numeric'})}
function campaignById(id){return campaigns.find(c=>c.id===id)||{name:'Silinmiş kampanya',stores:[]}}
const dbToUiStatus={pending:'Bekliyor',approved:'Onaylandı',rejected:'Reddedildi'};
async function loadData(){
  const [marketResult, branchResult, assignmentResult] = await Promise.all([supabaseClient.from('markets').select('*').order('name'), supabaseClient.from('market_branches').select('*').order('name'), supabaseClient.from('campaign_branch_assignments').select('*')]);
  if(marketResult.error) throw marketResult.error; if(branchResult.error) throw branchResult.error; if(assignmentResult.error) throw assignmentResult.error;
  markets=marketResult.data||[]; branches=branchResult.data||[]; branchAssignments=assignmentResult.data||[];
  const {data:campaignRows,error:campaignError}=await supabaseClient.from('campaigns').select('*').order('created_at',{ascending:false});
  if(campaignError) throw campaignError;
  campaigns=await Promise.all((campaignRows||[]).map(async c=>{let examplePhoto=null;if(c.example_photo_path){const {data}=await supabaseClient.storage.from('poster-photos').createSignedUrl(c.example_photo_path,3600);examplePhoto=data?.signedUrl||null;}const expired=!!c.ends_on && c.ends_on < new Date().toISOString().slice(0,10);return {id:c.id,name:c.name,start:c.starts_on,end:c.ends_on,stores:c.stores||[],notes:c.notes||'',status:expired?'Süresi doldu':(c.is_active?'Aktif':'Pasif'),isActive:!!c.is_active&&!expired,expired,createdBy:c.created_by,examplePhotoPath:c.example_photo_path||null,examplePhoto};}));
  if(currentProfile?.role==='admin') await reconcileCampaignAssignments();
  let query=supabaseClient.from('poster_submissions').select('*').order('submitted_at',{ascending:false});
  if(currentProfile?.role!=='admin') query=query.eq('submitted_by',currentProfile.id);
  const {data:submissionRows,error:submissionError}=await query;
  if(submissionError) throw submissionError;
  const rows=submissionRows||[];
  const ids=[...new Set(rows.map(r=>r.submitted_by).filter(Boolean))];
  let names={};
  if(ids.length){
    const {data:profiles,error:profilesError}=await supabaseClient.from('profiles').select('id,display_name').in('id',ids);
    if(!profilesError) names=Object.fromEntries((profiles||[]).map(x=>[x.id,x.display_name]));
  }
  submissions=await Promise.all(rows.map(async r=>{
    let photo=null;
    if(r.photo_path){const {data}=await supabaseClient.storage.from('poster-photos').createSignedUrl(r.photo_path,3600);photo=data?.signedUrl||null;}
    return {id:r.id,campaignId:r.campaign_id,store:r.store,branch:r.branch,person:names[r.submitted_by]||'Saha personeli',date:(r.submitted_at||'').slice(0,10),status:dbToUiStatus[r.status]||'Bekliyor',note:r.note||'',reviewNote:r.review_note||'',photo,photoPath:r.photo_path,submittedBy:r.submitted_by};
  }));
}
function base64UrlToUint8Array(value){
  const padding='='.repeat((4-value.length%4)%4);
  const base64=(value+padding).replace(/-/g,'+').replace(/_/g,'/');
  const raw=atob(base64);const output=new Uint8Array(raw.length);
  for(let i=0;i<raw.length;i++)output[i]=raw.charCodeAt(i);
  return output;
}
async function enablePushNotifications(){
  try{
    if(!currentProfile||!supabaseClient){toast('Önce hesabına giriş yapmalısın.');return;}
    if(!('serviceWorker' in navigator)||!('PushManager' in window)||!('Notification' in window)){toast('Bu tarayıcı web push bildirimlerini desteklemiyor.');return;}
    const isIOS=/iphone|ipad|ipod/i.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
    const isStandalone=window.matchMedia('(display-mode: standalone)').matches||window.navigator.standalone===true;
    if(isIOS&&!isStandalone){toast('iPhone’da bildirim için önce Paylaş > Ana Ekrana Ekle yap, sonra uygulama simgesinden aç.');return;}
    if(!PUSH_VAPID_PUBLIC_KEY||String(PUSH_VAPID_PUBLIC_KEY).includes('BURAYA')){toast('Push anahtarı ayarlanmamış. KURULUM.txt dosyasındaki PUSH_VAPID_PUBLIC_KEY adımını tamamla.');return;}
    const permission=await Notification.requestPermission();
    if(permission!=='granted'){toast('Bildirim izni verilmedi. Telefon ayarlarından izin vermen gerekebilir.');return;}
    const registration=await navigator.serviceWorker.register('./sw.js',{scope:'./'});
    await navigator.serviceWorker.ready;

    const expectedKey=base64UrlToUint8Array(PUSH_VAPID_PUBLIC_KEY);
    let subscription=await registration.pushManager.getSubscription();

    // Reuse the current subscription only if it was created with this VAPID public key.
    // Apple returns VapidPkHashMismatch when the subscription still belongs to an older key.
    if(subscription){
      const oldEndpoint=subscription.endpoint;
      const currentKey=subscription.options?.applicationServerKey;
      let keyMatches=false;
      if(currentKey){
        const currentBytes=new Uint8Array(currentKey);
        keyMatches=currentBytes.length===expectedKey.length&&currentBytes.every((byte,index)=>byte===expectedKey[index]);
      }
      if(!keyMatches){
        const unsubscribed=await subscription.unsubscribe();
        if(!unsubscribed)throw new Error('Eski bildirim aboneliği kaldırılamadı. Uygulamayı kapatıp tekrar açmayı dene.');
        const {error:deleteError}=await supabaseClient.from('push_subscriptions').delete().eq('endpoint',oldEndpoint).eq('user_id',currentProfile.id);
        if(deleteError)throw deleteError;
        subscription=null;
      }
    }

    if(!subscription){
      subscription=await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:expectedKey});
    }
    const {error}=await supabaseClient.from('push_subscriptions').upsert({endpoint:subscription.endpoint,user_id:currentProfile.id,subscription:subscription.toJSON(),updated_at:new Date().toISOString()},{onConflict:'endpoint'});
    if(error)throw error;
    toast('Telefon bildirimleri etkinleştirildi. Yeni abonelik kaydedildi.');
    if($('#notificationsDialog').open)openNotifications();
  }catch(error){console.error('Push bildirim kurulumu:',error);toast('Bildirimler etkinleştirilemedi: '+(error?.message||'Ayarları kontrol et.'));}
}
async function loadNotifications({notifyNew=false}={}){
  if(!currentProfile)return;
  const {data,error}=await supabaseClient.from('notifications').select('id,title,body,is_read,created_at,campaign_id').eq('user_id',currentProfile.id).order('created_at',{ascending:false}).limit(30);
  if(error){console.warn('Bildirimler alınamadı:',error.message);return;}
  const rows=data||[];
  // Native push notifications are delivered by sw.js; polling only refreshes the in-app badge.
  rows.forEach(n=>knownNotificationIds.add(n.id));
  notifications=rows;
  const badge=$('#notificationBadge');
  if(badge){const unread=notifications.filter(n=>!n.is_read).length;badge.textContent=unread>99?'99+':String(unread);badge.hidden=unread===0;}
}
async function openNotifications(){
  await loadNotifications();
  const d=$('#notificationsDialog');
  d.innerHTML=`<div class="modal-head"><div><span class="eyebrow">EKİP DUYURULARI</span><h2>Bildirimler</h2></div><button class="icon-button" type="button" data-close="notificationsDialog" aria-label="Kapat">×</button></div><div class="notification-list">${notifications.length?notifications.map(n=>`<article class="notification-item ${n.is_read?'':'unread'}"><span class="notification-symbol">${n.campaign_id?'◈':'•'}</span><div><b>${esc(n.title)}</b><p>${esc(n.body||'')}</p><time>${new Date(n.created_at).toLocaleString('tr-TR')}</time></div></article>`).join(''):'<div class="empty-state">Henüz bildirim yok. Yeni kampanyalar burada görünecek.</div>'}</div><div class="modal-actions"><button class="btn btn-quiet" type="button" data-action="enable-notifications">${('Notification' in window&&Notification.permission==='granted')?'Telefon bildirimlerini yeniden bağla':'Telefon bildirimlerini etkinleştir'}</button><button class="btn btn-primary" type="button" data-action="mark-notifications-read">Okundu olarak işaretle</button></div>`;
  if(!d.open)d.showModal();
}
function statusClass(s){return s==='Onaylandı'?'status-approved':s==='Reddedildi'?'status-rejected':s==='Aktif'?'status-active':'status-pending'}
function statusPill(s){return `<span class="status-pill ${statusClass(s)}">${esc(s)}</span>`}
function toast(msg){const el=$('#toast');el.textContent=msg;el.classList.add('show');clearTimeout(toast.timer);toast.timer=setTimeout(()=>el.classList.remove('show'),2800)}
function pageHeading(kicker,title,sub,button=''){return `<div class="page-heading"><div><span class="eyebrow">${kicker}</span><h1>${title}</h1><p class="subheading">${sub}</p></div>${button}</div>`}
function campaignStats(c){const rows=submissions.filter(s=>s.campaignId===c.id);return {total:rows.length,approved:rows.filter(s=>s.status==='Onaylandı').length,rejected:rows.filter(s=>s.status==='Reddedildi').length,pending:rows.filter(s=>s.status==='Bekliyor').length}}
function campaignProgress(c){const stats=campaignStats(c);const target=Math.max(1,c.stores?.length||1);return Math.min(100,Math.round(stats.approved/target*100))}
const themeIcons={light:'<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M2 12h2m16 0h2M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42"/></svg>',dark:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.8 14.1A8.7 8.7 0 0 1 9.9 3.2 8.8 8.8 0 1 0 20.8 14.1Z"/></svg>'};
function updateThemeButtons(theme){[['#themeToggle','header'],['#loginThemeToggle','login']].forEach(([selector,where])=>{const b=document.querySelector(selector);if(!b)return;const next=theme==='dark'?'light':'dark';b.innerHTML=themeIcons[next];b.setAttribute('aria-label',next==='dark'?'Koyu temayı aç':'Açık temayı aç');b.title=next==='dark'?'Koyu temaya geç':'Açık temaya geç';b.dataset.mode=next;});}
function applyTheme(theme){document.documentElement.dataset.theme=theme;updateThemeButtons(theme);try{localStorage.setItem('algida-afis-theme',theme)}catch(e){}}
function initTheme(){let theme='light';try{theme=localStorage.getItem('algida-afis-theme')||'light'}catch(e){}const actions=document.querySelector('.top-actions');if(actions&&!document.querySelector('#themeToggle')){const b=document.createElement('button');b.id='themeToggle';b.className='icon-button theme-toggle';b.type='button';b.addEventListener('click',()=>applyTheme(document.documentElement.dataset.theme==='dark'?'light':'dark'));const logout=document.querySelector('#logoutBtn');if(logout)actions.insertBefore(b,logout);else actions.appendChild(b);}const gate=document.querySelector('#authGate');if(gate&&!document.querySelector('#loginThemeToggle')){const b=document.createElement('button');b.id='loginThemeToggle';b.className='icon-button login-theme-toggle';b.type='button';b.setAttribute('aria-label','Temayı değiştir');b.addEventListener('click',()=>applyTheme(document.documentElement.dataset.theme==='dark'?'light':'dark'));gate.appendChild(b);}applyTheme(theme);}
function render(){initTheme();if(currentProfile?.role!=='admin'&&activeView==='users')activeView='dashboard'; $('#pendingNav').textContent=submissions.filter(s=>s.status==='Bekliyor').length; const titles={dashboard:'Genel Bakış',campaigns:'Kampanyalar',submissions:currentProfile?.role==='admin'?'Fotoğraf Kontrolü':'Afişlerim',stores:'Market ve Şubeler',users:'Kullanıcı Yönetimi',reports:'Raporlar'};$('#pageTitle').textContent=titles[activeView];$('#todayLabel').textContent=new Date().toLocaleDateString('tr-TR',{weekday:'short',day:'2-digit',month:'short'});$('#appContent').innerHTML=({dashboard:renderDashboard,campaigns:renderCampaigns,submissions:renderSubmissions,stores:renderStores,users:renderUsers,reports:renderReports})[activeView]();$$('.nav-item').forEach(b=>b.classList.toggle('active',b.dataset.view===activeView));$$('[data-action="campaign"]').forEach(el=>el.hidden=currentProfile?.role!=='admin');$$('[data-admin-only]').forEach(el=>el.hidden=currentProfile?.role!=='admin');}
function renderDashboard(){const pending=submissions.filter(s=>s.status==='Bekliyor').length,approved=submissions.filter(s=>s.status==='Onaylandı').length,active=campaigns.filter(c=>c.status==='Aktif').length,doneRate=submissions.length?Math.round(approved/submissions.length*100):0;const latest=[...submissions].sort((a,b)=>b.date.localeCompare(a.date)).slice(0,4);return `${pageHeading('SAHA OPERASYONLARI','Selam ekip 👋','Afiş uygulamalarını, kampanya ilerlemesini ve sahadan gelen kayıtları tek yerden takip et.',`<button class="btn btn-primary" data-action="upload">＋ Fotoğraf yükle</button>`)}
<div class="stats-grid"><article class="stat-card"><div class="stat-top">Aktif kampanya <span class="stat-icon tone-red">◈</span></div><div class="stat-value">${active}</div><div class="stat-foot">Takipte olan kampanyalar</div></article><article class="stat-card"><div class="stat-top">İnceleme bekleyen <span class="stat-icon tone-amber">◷</span></div><div class="stat-value">${pending}</div><div class="stat-foot">Yönetici onayı gerekiyor</div></article><article class="stat-card"><div class="stat-top">Onaylanan kayıt <span class="stat-icon tone-green">✓</span></div><div class="stat-value">${approved}</div><div class="stat-foot">Fotoğraf kontrolünden geçti</div></article><article class="stat-card"><div class="stat-top">Onay oranı <span class="stat-icon tone-blue">↗</span></div><div class="stat-value">%${doneRate}</div><div class="stat-foot">Tüm demo kayıtları üzerinden</div></article></div>
<div class="dashboard-grid"><section class="panel"><div class="panel-head"><div><h3>Kampanya ilerlemesi</h3><p>Onaylanmış saha kayıtlarının özeti</p></div><button class="text-button" data-view="campaigns">Tüm kampanyalar →</button></div><div class="campaign-list">${campaigns.length?campaigns.map(c=>`<div class="campaign-row"><div class="campaign-art">${c.examplePhoto?`<img src="${c.examplePhoto}" alt="${esc(c.name)} örnek afişi"/>`:'A'}</div><div class="campaign-info"><b>${esc(c.name)}</b><small>${fmtDate(c.start)} – ${fmtDate(c.end)} · ${c.stores.length} market</small><div class="progress"><span style="width:${campaignProgress(c)}%"></span></div></div><span class="campaign-percent">${campaignProgress(c)}%</span></div>`).join(''):'<div class="empty-state">Henüz kampanya yok.</div>'}</div></section>
<section class="panel"><div class="panel-head"><div><h3>Son saha hareketleri</h3><p>En son oluşturulan kayıtlar</p></div><button class="text-button" data-view="submissions">Tümünü gör →</button></div><div class="activity-list">${latest.length?latest.map(s=>`<div class="activity-item"><div class="activity-icon">${s.status==='Onaylandı'?'✓':s.status==='Reddedildi'?'!':'◷'}</div><div><b>${esc(s.store)} · ${esc(s.branch)}</b><p>${esc(campaignById(s.campaignId).name)}</p><time>${fmtDate(s.date)} · ${esc(s.person)}</time></div><div style="margin-left:auto">${statusPill(s.status)}</div></div>`).join(''):'<div class="empty-state">Henüz hareket yok.</div>'}</div></section></div>
<section class="panel"><div class="panel-head"><div><h3>Hızlı erişim</h3><p>Sık kullanılan işlemler</p></div></div><div class="quick-actions"><button class="btn btn-quiet" data-action="campaign">＋ Kampanya oluştur</button> <button class="btn btn-quiet" data-view="submissions">▧ Fotoğrafları incele (${pending})</button> <button class="btn btn-quiet" data-view="stores">⌖ Market listesini aç</button></div></section>`}
function renderCampaigns(){
  const visibleCampaigns=campaigns.filter(c=>{
    if(campaignMarketFilter!=='all'&&!(c.stores||[]).some(name=>String(name||'').trim().toLocaleLowerCase('tr-TR')===String(campaignMarketFilter||'').trim().toLocaleLowerCase('tr-TR')))return false;
    const campaignStart=String(c.start||'').slice(0,10),campaignEnd=String(c.end||'').slice(0,10);
    // Show campaigns whose active date interval overlaps the selected date interval.
    if(campaignDateFrom&&(!campaignEnd||campaignEnd<campaignDateFrom))return false;
    if(campaignDateTo&&(!campaignStart||campaignStart>campaignDateTo))return false;
    return true;
  });
  return `${pageHeading('KAMPANYA YÖNETİMİ','Kampanyalar','Kampanya tarihlerini, hedef marketleri ve saha ilerlemesini yönetin.',`<button class="btn btn-primary" data-action="campaign">＋ Kampanya oluştur</button>`)}
  <section class="panel campaign-filter-panel"><div class="campaign-filter-heading"><div><span class="eyebrow">HIZLI FİLTRE</span><h3>Kampanyaları daralt</h3><p>Tarih aralığına ve hedef markete göre kampanyaları görüntüle.</p></div><button class="btn btn-quiet btn-small" data-action="campaign-filter-reset">Filtreleri temizle</button></div><div class="campaign-filter-grid"><label>Başlangıç tarihi<input id="campaignDateFrom" type="date" max="${esc(campaignDateTo)}" value="${esc(campaignDateFrom)}" /></label><label>Bitiş tarihi<input id="campaignDateTo" type="date" min="${esc(campaignDateFrom)}" value="${esc(campaignDateTo)}" /></label><label>Hedef market<select id="campaignMarketFilter"><option value="all" ${campaignMarketFilter==='all'?'selected':''}>Tüm marketler</option>${markets.filter(m=>m.is_active!==false).map(m=>`<option value="${esc(m.name)}" ${campaignMarketFilter===m.name?'selected':''}>${esc(m.name)}</option>`).join('')}</select></label></div><div class="campaign-filter-result">Filtreye uyan <b>${visibleCampaigns.length}</b> / ${campaigns.length} kampanya</div></section>
  <section class="panel"><div class="panel-head"><div><h3>Kampanya listesi</h3><p>${visibleCampaigns.length} kampanya görüntüleniyor</p></div><span class="status-pill status-active">Canlı takip</span></div><div class="table-wrap"><table><thead><tr><th>KAMPANYA</th><th>TARİH ARALIĞI</th><th>HEDEF MARKET</th><th>İLERLEME</th><th>DURUM</th><th></th></tr></thead><tbody>${visibleCampaigns.map(c=>`<tr><td><div class="campaign-table-title">${c.examplePhoto?`<img src="${c.examplePhoto}" alt="Örnek afiş"/>`:''}<div><b>${esc(c.name)}</b><div class="muted" style="font-size:10px;margin-top:4px">${esc(c.notes||'Ek not yok')}</div></div></div></td><td>${fmtDate(c.start)}<div class="muted">– ${fmtDate(c.end)}</div></td><td>${c.stores.length} market</td><td style="min-width:125px"><b>%${campaignProgress(c)}</b><div class="progress"><span style="width:${campaignProgress(c)}%"></span></div></td><td>${statusPill(c.status)}</td><td><div class="campaign-row-actions">${currentProfile?.role==='admin'?`<button class="btn btn-quiet btn-small" data-action="campaign-edit" data-id="${c.id}">Düzenle</button> <button class="btn btn-danger-soft btn-small" data-action="campaign-delete" data-id="${c.id}">Sil</button>`:''} <button class="btn btn-quiet btn-small" data-action="campaign-detail" data-id="${c.id}">Detay</button></div></td></tr>`).join('')||'<tr><td colspan="6">Seçtiğin filtrelere uygun kampanya bulunamadı.</td></tr>'}</tbody></table></div></section><div class="hint-box">İpucu: Tarih filtresi seçilen aralıkla kesişen kampanyaları gösterir. Kampanya kayıtları Supabase üzerinden ekip üyeleriyle paylaşılır.</div>`
}
function renderSubmissions(){let list=[...submissions].filter(s=>submissionFilter==='Tümü'||s.status===submissionFilter).sort((a,b)=>b.date.localeCompare(a.date));const admin=currentProfile?.role==='admin';return `${pageHeading(admin?'KALİTE KONTROL':'SAHA KAYITLARIM',admin?'Fotoğraf kontrolü':'Afişlerim',admin?'Saha personelinin yüklediği fotoğrafları inceleyin; onaylayın veya gerekçeyle reddedin.':'Gönderdiğin afişlerin durumunu ve varsa yönetici açıklamasını buradan takip et.',`<button class="btn btn-primary" data-action="upload">＋ Fotoğraf yükle</button>`)}<section class="panel"><div class="panel-head"><div><h3>${admin?'Saha kayıtları':'Gönderdiğim fotoğraflar'}</h3><p>${admin?'Fotoğraf ve kampanya uygunluk kontrolü':'Reddedilen kayıtların açıklamalarını inceleyip yeniden gönderebilirsin.'}</p></div><div class="filter-tabs">${['Tümü','Bekliyor','Onaylandı','Reddedildi'].map(f=>`<button class="${submissionFilter===f?'active':''}" data-filter="${f}">${f}</button>`).join('')}</div></div>${list.length?`<div class="submission-grid">${list.map(s=>`<article class="submission-card"><div class="submission-photo">${s.photo?`<img src="${s.photo}" alt="${esc(s.store)} afiş fotoğrafı"/>`:`<div class="photo-placeholder"><strong>ALGIDA</strong>Fotoğraf önizlemesi yok</div>`}</div><div class="submission-body"><div class="submission-meta"><span class="muted">${esc(s.store)}</span>${statusPill(s.status)}</div><h3>${esc(s.branch)}</h3><p>${esc(campaignById(s.campaignId).name)}<br/>${fmtDate(s.date)} · ${esc(s.person)}</p>${s.note?`<p><b>Gönderi notu:</b> “${esc(s.note)}”</p>`:''}${s.reviewNote?`<div class="rejection-note"><b>${s.status==='Reddedildi'?'Reddetme nedeni':'Yönetici notu'}:</b> ${esc(s.reviewNote)}</div>`:''}<div class="submission-actions"><button class="btn btn-quiet btn-small" data-action="submission-detail" data-id="${s.id}">İncele</button>${admin&&s.status==='Bekliyor'?`<button class="btn btn-approved btn-small" data-action="approve" data-id="${s.id}">✓ Onayla</button><button class="btn btn-danger-soft btn-small" data-action="reject" data-id="${s.id}">× Reddet</button>`:''}${!admin&&s.status==='Reddedildi'?`<button class="btn btn-primary btn-small" data-action="resubmit" data-id="${s.id}">↻ Düzelterek yeniden gönder</button>`:''}</div></div></article>`).join('')}</div>`:'<div class="empty-state"><b>Bu filtrede kayıt yok.</b>Farklı bir durum seçebilir veya yeni fotoğraf ekleyebilirsin.</div>'}</section>`}
function renderStores(){
  const admin=currentProfile?.role==='admin';
  const assignedBranches=admin?branches:branches.filter(b=>b.assigned_user_id===currentProfile?.id);
  const visibleMarketIds=new Set(assignedBranches.map(b=>b.market_id));
  const baseMarkets=admin?markets:markets.filter(m=>visibleMarketIds.has(m.id));
  if(storesMarketFilter!=='all'&&!baseMarkets.some(m=>m.id===storesMarketFilter))storesMarketFilter='all';
  const query=storesSearch.trim().toLocaleLowerCase('tr-TR');
  const visibleMarkets=baseMarkets.filter(m=>{
    if(storesMarketFilter!=='all'&&m.id!==storesMarketFilter)return false;
    const marketBranches=assignedBranches.filter(b=>b.market_id===m.id);
    return !query||m.name.toLocaleLowerCase('tr-TR').includes(query)||marketBranches.some(b=>b.name.toLocaleLowerCase('tr-TR').includes(query)||(b.address||'').toLocaleLowerCase('tr-TR').includes(query));
  });
  const visibleBranches=assignedBranches.filter(b=>{const market=baseMarkets.find(m=>m.id===b.market_id);return visibleMarkets.some(m=>m.id===b.market_id)&&(!query||(market?.name||'').toLocaleLowerCase('tr-TR').includes(query)||b.name.toLocaleLowerCase('tr-TR').includes(query)||(b.address||'').toLocaleLowerCase('tr-TR').includes(query));});
  const totalBranches=visibleBranches.length;
  const uploadedBranches=visibleBranches.filter(b=>{const m=markets.find(x=>x.id===b.market_id);return m&&submissions.some(s=>s.store===m.name&&s.branch===b.name&&(s.photoPath||s.photo));}).length;
  const activeCampaignAssignments=visibleBranches.reduce((sum,b)=>sum+branchAssignments.filter(a=>a.branch_id===b.id&&campaignById(a.campaign_id).isActive).length,0);
  const marketCards=visibleMarkets.map(m=>{
    const marketBranches=visibleBranches.filter(b=>b.market_id===m.id);
    const count=submissions.filter(s=>s.store===m.name).length;
    const uploaded=marketBranches.filter(b=>submissions.some(s=>s.store===m.name&&s.branch===b.name&&(s.photoPath||s.photo))).length;
    const pct=marketBranches.length?Math.round(uploaded/marketBranches.length*100):0;
    return `<article class="store-card"><div class="store-card-top"><div class="store-mark">${esc((m.name||'?').slice(0,2).toLocaleUpperCase('tr-TR'))}</div>${statusPill(m.is_active?'Aktif':'Pasif')}</div><h3>${esc(m.name)}</h3><p>${marketBranches.length} şube · ${count} fotoğraf kaydı</p><div class="store-card-metrics"><span><b>${uploaded}</b><small>Afiş gelen</small></span><span><b>${Math.max(0,marketBranches.length-uploaded)}</b><small>Afiş beklenen</small></span></div><div class="store-card-progress"><div><span style="width:${pct}%"></span></div><small>%${pct} şube fotoğraf aldı</small></div><div class="submission-actions">${admin?`<button class="btn btn-quiet btn-small" data-action="market-edit" data-id="${m.id}">Düzenle</button><button class="btn btn-danger-soft btn-small" data-action="market-delete" data-id="${m.id}">Sil</button><button class="btn btn-primary btn-small" data-action="branch-add" data-id="${m.id}">＋ Şube</button>`:`<button class="btn btn-quiet btn-small" data-action="stores-market-select" data-id="${m.id}">Şubeleri gör</button>`}</div></article>`;
  }).join('');
  const branchRows=visibleMarkets.flatMap(market=>visibleBranches.filter(b=>b.market_id===market.id).map(b=>{
    const m=visibleMarkets.find(x=>x.id===b.market_id);
    const assigned=branchAssignments.filter(a=>a.branch_id===b.id).map(a=>campaignById(a.campaign_id));
    const active=assigned.filter(c=>c.isActive);
    const rows=submissions.filter(s=>s.store===m?.name&&s.branch===b.name);
    const uploaded=rows.some(x=>x.photoPath||x.photo);
    const approved=rows.some(x=>x.status==='Onaylandı');
    return `<tr><td><b>${esc(m?.name||'—')}</b></td><td><b>${esc(b.name)}</b>${b.assigned_user_id?`<div class="muted">Sorumlu: ${esc(managedProfiles.find(u=>u.id===b.assigned_user_id)?.display_name||'Atanan kullanıcı')}</div>`:'<div class="muted">Sorumlu atanmamış</div>'}${b.address?`<div class="muted">${esc(b.address)}</div>`:''}</td><td><span class="store-count-pill">${active.length} aktif</span><div class="muted">${assigned.length} toplam</div></td><td>${uploaded?`<span class="store-upload-state ${approved?'approved':'pending'}">${approved?'✓ Onaylı afiş':'◷ Fotoğraf gönderildi'}</span>`:'<span class="store-upload-state missing">Afiş yüklenmedi</span>'}${rows.length?`<div class="muted">${rows.length} kayıt</div>`:''}</td><td><button class="btn btn-quiet btn-small" data-action="branch-detail" data-id="${b.id}">Şube detayı</button> ${admin?`<button class="btn btn-quiet btn-small" data-action="branch-edit" data-id="${b.id}">Düzenle</button><button class="btn btn-danger-soft btn-small" data-action="branch-delete" data-id="${b.id}">Sil</button>`:''}</td></tr>`;
  })).join('');
  return `${pageHeading('SAHA NOKTALARI','Market ve Şubeler',admin?'Marketleri, şubeleri ve saha kapsamını tek ekrandan yönetin.':'Yalnızca size atanmış market ve şubeler görüntülenir.',admin?`<button class="btn btn-primary" data-action="market-add">＋ Market ekle</button>`:'')}
  <section class="store-overview-strip"><div><span class="store-overview-icon">⌖</span><div><small>Görüntülenen şube</small><b>${totalBranches}</b></div></div><div><span class="store-overview-icon green">✓</span><div><small>Afiş gelen şube</small><b>${uploadedBranches}</b></div></div><div><span class="store-overview-icon amber">◷</span><div><small>Afiş beklenen</small><b>${Math.max(0,totalBranches-uploadedBranches)}</b></div></div><div><span class="store-overview-icon blue">◈</span><div><small>Aktif kampanya ataması</small><b>${activeCampaignAssignments}</b></div></div></section>
  <section class="panel store-tools"><div class="store-tools-heading"><div><h3>Market listesi</h3><p>Market veya şube adıyla ara, listeyi daralt.</p></div><span class="store-result-count">${visibleMarkets.length} market</span></div><div class="store-filter-controls"><label class="store-search-box"><span>⌕</span><input id="storesSearch" type="search" value="${esc(storesSearch)}" placeholder="Market, şube veya adres ara…" /></label><label class="store-market-select"><span>Market</span><select id="storesMarketFilter"><option value="all" ${storesMarketFilter==='all'?'selected':''}>Tüm marketler</option>${baseMarkets.map(m=>`<option value="${m.id}" ${storesMarketFilter===m.id?'selected':''}>${esc(m.name)}</option>`).join('')}</select></label><button class="btn btn-quiet btn-small" data-action="stores-filter-reset">Temizle</button></div></section>
  ${assignmentSyncWarning&&admin?`<div class="hint-box">Kampanya atamaları otomatik kontrol edilirken bir hata oluştu: ${esc(assignmentSyncWarning)}. Supabase izinlerini kontrol etmek gerekebilir.</div>`:''}
  
  <div class="store-grid">${marketCards||(admin?'<div class="empty-state">Aramana uygun market bulunamadı.</div>':'<div class="empty-state">Size atanmış market veya şube bulunmuyor.</div>')}</div>
  <section class="panel store-branches-panel"><div class="panel-head"><div><h3>Şubeler ve saha durumu</h3><p>Fotoğraf yükleme ve kampanya atamaları şube bazında gösterilir.</p></div>${admin?`<button class="btn btn-quiet btn-small" data-action="branch-add-select">＋ Şube ekle</button>`:''}</div><div class="table-wrap"><table><thead><tr><th>MARKET</th><th>ŞUBE</th><th>KAMPANYALAR</th><th>AFİŞ DURUMU</th><th>İŞLEMLER</th></tr></thead><tbody>${branchRows||(admin?'<tr><td colspan="5">Bu filtreye uygun şube bulunamadı.</td></tr>':'<tr><td colspan="5">Size atanmış şube bulunmuyor.</td></tr>')}</tbody></table></div></section>`;
}
function renderUsers(){if(currentProfile?.role!=='admin')return '<div class="hint-box">Bu sayfayı yalnızca yöneticiler görebilir.</div>';return `${pageHeading('ERİŞİM YÖNETİMİ','Kullanıcı Yönetimi','Yeni yönetici ve saha personeli hesapları oluşturun.',`<button class="btn btn-primary" data-action="user-add">＋ Kullanıcı ekle</button>`)}<section class="panel"><div class="panel-head"><div><h3>Sistem kullanıcıları</h3><p>${managedProfiles.length} kullanıcı profili</p></div><button class="btn btn-quiet btn-small" data-action="users-refresh">Yenile</button></div><div class="table-wrap"><table><thead><tr><th>AD SOYAD</th><th>GİRİŞ E-POSTASI</th><th>ROL</th><th>EKİP</th><th>HESAP</th><th>İŞLEMLER</th></tr></thead><tbody>${managedProfiles.map(u=>`<tr><td><b>${esc(u.display_name||'—')}</b></td><td>${esc(u.email||'—')}</td><td>${u.role==='admin'?'Yönetici':'Saha personeli'}</td><td>${esc(u.team||'—')}</td><td><span class="status-pill status-active">Aktif</span></td><td><button class="btn btn-quiet btn-small" data-action="user-edit" data-id="${u.id}">Düzenle</button> <button class="btn btn-danger-soft btn-small" data-action="user-delete" data-id="${u.id}">Sil</button></td></tr>` ).join('')||'<tr><td colspan="6">Kullanıcılar yüklenmedi. Yenile düğmesine basın.</td></tr>'}</tbody></table></div><div class="hint-box" style="margin-top:14px">Güvenlik için kullanıcı hesabı, yalnızca yönetici doğrulaması yapan Supabase Edge Function üzerinden oluşturulur. Service-role anahtarı tarayıcıya konulmaz.</div></section>`}

function renderReports(){
  if(currentProfile?.role!=='admin')return `${pageHeading('PERFORMANS','Raporlar','Kendi gönderimlerinin durumunu takip et.')}${renderMySubmissions()}`;
  const approved=submissions.filter(s=>s.status==='Onaylandı').length,pending=submissions.filter(s=>s.status==='Bekliyor').length,rejected=submissions.filter(s=>s.status==='Reddedildi').length;
  const campaignId=$('#performanceCampaignFilter')?.value||'all';
  const selectedCampaign=campaignId==='all'?null:campaignById(campaignId);
  const relevantAssignments=branchAssignments.filter(a=>!selectedCampaign||a.campaign_id===selectedCampaign.id);
  const assignedBranches=[...new Set(relevantAssignments.map(a=>a.branch_id))];
  const branchKey=(marketName,branchName)=>`${marketName}|||${branchName}`;
  const branchApproved=new Set();
  const branchUploaded=new Set();
  const filteredSubmissions=submissions.filter(s=>!selectedCampaign||s.campaignId===selectedCampaign.id);
  for(const s of filteredSubmissions){const key=branchKey(s.store,s.branch);if(s.status==='Onaylandı')branchApproved.add(key);if(s.photoPath||s.photo)branchUploaded.add(key)}
  const eligibleBranches=branches.filter(b=>!selectedCampaign||relevantAssignments.some(a=>a.branch_id===b.id));
  const isBranchAssignedToUser=(b,user)=>b.assigned_user_id===user.id;
  const userStats=managedProfiles.filter(u=>u.role==='field').map(u=>{
    const mine=eligibleBranches.filter(b=>isBranchAssignedToUser(b,u));
    const approvedCount=mine.filter(b=>{const m=markets.find(x=>x.id===b.market_id);return m&&branchApproved.has(branchKey(m.name,b.name))}).length;
    const uploadedCount=mine.filter(b=>{const m=markets.find(x=>x.id===b.market_id);return m&&branchUploaded.has(branchKey(m.name,b.name))}).length;
    const rows=filteredSubmissions.filter(s=>s.submittedBy===u.id);
    return {user:u,assigned:mine.length,approved:approvedCount,uploaded:uploadedCount,rate:mine.length?Math.round(approvedCount/mine.length*100):0,uploads:rows.length,accepted:rows.filter(s=>s.status==='Onaylandı').length,pending:rows.filter(s=>s.status==='Bekliyor').length,rejected:rows.filter(s=>s.status==='Reddedildi').length};
  }).sort((a,b)=>b.rate-a.rate||b.approved-a.approved);
  const marketStats=markets.map(m=>{const bs=eligibleBranches.filter(b=>b.market_id===m.id);const ac=bs.filter(b=>branchAssignments.some(a=>a.branch_id===b.id&&(!selectedCampaign||a.campaign_id===selectedCampaign.id))).length;const approvedCount=bs.filter(b=>branchAssignments.some(a=>a.branch_id===b.id&&(!selectedCampaign||a.campaign_id===selectedCampaign.id))&&branchApproved.has(branchKey(m.name,b.name))).length;const uploaded=bs.filter(b=>branchUploaded.has(branchKey(m.name,b.name))).length;return {market:m,assigned:ac,approved:approvedCount,uploaded,rate:ac?Math.round(approvedCount/ac*100):0,rows:filteredSubmissions.filter(s=>s.store===m.name)};}).filter(x=>x.assigned||x.rows.length);
  const totalAssigned=eligibleBranches.length;const approvedAssigned=eligibleBranches.filter(b=>{const m=markets.find(x=>x.id===b.market_id);return m&&branchAssignments.some(a=>a.branch_id===b.id&&(!selectedCampaign||a.campaign_id===selectedCampaign.id))&&branchApproved.has(branchKey(m.name,b.name))}).length;
  const totalRate=totalAssigned?Math.round(approvedAssigned/totalAssigned*100):0;
  // Campaign/branch-level follow-up: each assigned branch is counted once per campaign.
  const followupMap=new Map();
  relevantAssignments.forEach(a=>{
    const branch=branches.find(b=>b.id===a.branch_id);
    const market=branch&&markets.find(m=>m.id===branch.market_id);
    if(!branch||!market)return;
    const key=`${a.campaign_id}|||${branch.id}`;
    if(followupMap.has(key))return;
    const rows=submissions.filter(s=>s.campaignId===a.campaign_id&&s.store===market.name&&s.branch===branch.name);
    const approvedRow=rows.find(s=>s.status==='Onaylandı');
    const pendingRow=rows.filter(s=>s.status==='Bekliyor').sort((x,y)=>y.date.localeCompare(x.date))[0];
    const rejectedRow=rows.filter(s=>s.status==='Reddedildi').sort((x,y)=>y.date.localeCompare(x.date))[0];
    const state=approvedRow?'approved':pendingRow?'pending':rejectedRow?'rejected':'missing';
    followupMap.set(key,{key,branch,market,campaign:campaignById(a.campaign_id),state,row:state==='pending'?pendingRow:state==='rejected'?rejectedRow:null,assignee:branch.assigned_user_id?managedProfiles.find(u=>u.id===branch.assigned_user_id)?.display_name||'Atanmış kullanıcı':'Sorumlu atanmamış'});
  });
  const allFollowups=[...followupMap.values()];
  const followups=allFollowups.filter(x=>reportStaffFilter==='all'||(reportStaffFilter==='unassigned'?!x.branch.assigned_user_id:x.branch.assigned_user_id===reportStaffFilter));
  const followupCounts={missing:followups.filter(x=>x.state==='missing').length,pending:followups.filter(x=>x.state==='pending').length,rejected:followups.filter(x=>x.state==='rejected').length,approved:followups.filter(x=>x.state==='approved').length};
  const followupSort={missing:0,rejected:1,pending:2,approved:3};
  const filteredFollowups=followups.filter(x=>reportFollowupFilter==='all'||x.state===reportFollowupFilter).sort((a,b)=>followupSort[a.state]-followupSort[b.state]||a.market.name.localeCompare(b.market.name,'tr')||a.branch.name.localeCompare(b.branch.name,'tr'));
  const followupPageSize=8;
  const followupPageCount=Math.max(1,Math.ceil(filteredFollowups.length/followupPageSize));
  reportFollowupPage=Math.min(reportFollowupPage,followupPageCount);
  const followupRows=filteredFollowups.slice((reportFollowupPage-1)*followupPageSize,reportFollowupPage*followupPageSize);
  const statusTotal=Math.max(1,filteredSubmissions.length);
  return `${pageHeading('SAHA PERFORMANSI','Performans analizi','Personel, market ve kampanya bazında onaylı şube tamamlama oranlarını takip edin.',`<button class="btn btn-quiet" data-action="export">↓ CSV dışa aktar</button>`)}
  <section class="panel performance-filters"><div class="filter-intro"><span class="filter-symbol">⌕</span><div><span class="eyebrow">RAPOR ÖZELLEŞTİRME</span><h3>Kampanya kapsamı</h3><p>Performans verilerini seçtiğin kampanyaya göre filtrele.</p></div></div><div class="campaign-select-wrap"><label for="performanceCampaignFilter">Görüntülenecek kampanya</label><div class="campaign-select-control"><span class="campaign-select-icon">◈</span><select id="performanceCampaignFilter"><option value="all" ${campaignId==='all'?'selected':''}>Tüm kampanyalar</option>${campaigns.map(c=>`<option value="${c.id}" ${campaignId===c.id?'selected':''}>${esc(c.name)}</option>`).join('')}</select><span class="select-chevron">⌄</span></div><span class="filter-help">${selectedCampaign?`Seçili: ${esc(selectedCampaign.name)}`:'Genel görünüm · tüm kampanyalar dahil'}</span></div><div class="filter-info"><span>ⓘ</span><p>Onaylı tamamlama, atanmış farklı şubeler içindeki en az bir onaylı gönderisi bulunan şubelerin oranıdır. Aynı şube tekrar sayılmaz.</p></div></section>
  <div class="stats-grid"><article class="stat-card"><div class="stat-top">Atanmış şube <span class="stat-icon tone-blue">⌖</span></div><div class="stat-value">${totalAssigned}</div><div class="stat-foot">Seçili kapsamda</div></article><article class="stat-card"><div class="stat-top">Onaylı tamamlanan <span class="stat-icon tone-green">✓</span></div><div class="stat-value">${approvedAssigned}</div><div class="stat-foot">Farklı şubeler</div></article><article class="stat-card"><div class="stat-top">Onaylı tamamlama <span class="stat-icon tone-green">↗</span></div><div class="stat-value">%${totalRate}</div><div class="stat-foot">Ana performans ölçütü</div></article><article class="stat-card"><div class="stat-top">Bekleyen / reddedilen <span class="stat-icon tone-amber">◷</span></div><div class="stat-value">${filteredSubmissions.filter(s=>s.status==='Bekliyor').length} / ${filteredSubmissions.filter(s=>s.status==='Reddedildi').length}</div><div class="stat-foot">Değerlendirme kayıtları</div></article></div>
  <section class="panel followup-panel"><div class="panel-head"><div><span class="eyebrow">AKILLI TAKİP</span><h3>Şube afiş durumu</h3><p>${selectedCampaign?esc(selectedCampaign.name):'Tüm kampanyalar'} · atanmış şubelerin tamamı</p></div><span class="followup-total">${filteredFollowups.length} şube</span></div>
  <div class="followup-staff-filter"><label for="reportStaffFilter">Personel seç</label><select id="reportStaffFilter"><option value="all" ${reportStaffFilter==='all'?'selected':''}>Tüm personeller</option><option value="unassigned" ${reportStaffFilter==='unassigned'?'selected':''}>Personel atanmamış şubeler</option>${managedProfiles.filter(u=>u.role==='field').map(u=>`<option value="${u.id}" ${reportStaffFilter===u.id?'selected':''}>${esc(u.display_name||u.email||'İsimsiz personel')}${u.team?' · '+esc(u.team):''}</option>`).join('')}</select><span>Seçilen personelin sorumlu olduğu şubelerin afiş durumları gösterilir.</span></div><div class="followup-summary"><div class="followup-stat"><span class="followup-dot missing"></span><div><b>${followupCounts.missing}</b><small>Fotoğraf yok</small></div></div><div class="followup-stat"><span class="followup-dot rejected"></span><div><b>${followupCounts.rejected}</b><small>Reddedildi</small></div></div><div class="followup-stat"><span class="followup-dot pending"></span><div><b>${followupCounts.pending}</b><small>Onay bekliyor</small></div></div><div class="followup-stat"><span class="followup-dot approved"></span><div><b>${followupCounts.approved}</b><small>Onaylandı</small></div></div></div>
  <div class="followup-filter-tabs">${[['all','Tümü',followups.length],['missing','Afiş yüklenmedi',followupCounts.missing],['pending','Bekliyor',followupCounts.pending],['rejected','Reddedildi',followupCounts.rejected],['approved','Onaylandı',followupCounts.approved]].map(([value,label,count])=>`<button class="${reportFollowupFilter===value?'active':''}" data-action="followup-filter" data-filter="${value}">${label}<span>${count}</span></button>`).join('')}</div>
  ${followupRows.length?`<div class="followup-list">${followupRows.map(x=>`<div class="followup-row"><span class="followup-state ${x.state}">${x.state==='missing'?'Afiş yok':x.state==='rejected'?'Reddedildi':x.state==='approved'?'Onaylandı':'Bekliyor'}</span><div class="followup-main"><b>${esc(x.market.name)} · ${esc(x.branch.name)}</b><small>${esc(x.campaign.name)} · ${esc(x.assignee)}</small>${x.state==='rejected'&&x.row?.reviewNote?`<small class="followup-reason">Ret nedeni: ${esc(x.row.reviewNote)}</small>`:''}</div><div class="followup-action">${x.row?`<button class="btn btn-quiet btn-small" data-action="submission-detail" data-id="${x.row.id}">Kaydı aç</button>`:`<button class="btn btn-quiet btn-small" data-action="branch-detail" data-id="${x.branch.id}">Şube detayı</button>`}</div></div>`).join('')}</div><div class="followup-pagination"><span>${filteredFollowups.length?((reportFollowupPage-1)*followupPageSize+1):0}–${Math.min(reportFollowupPage*followupPageSize,filteredFollowups.length)} / ${filteredFollowups.length} şube</span><div><button class="btn btn-quiet btn-small" data-action="followup-page" data-page="${reportFollowupPage-1}" ${reportFollowupPage<=1?'disabled':''}>← Önceki</button><span class="followup-page-number">${reportFollowupPage} / ${followupPageCount}</span><button class="btn btn-quiet btn-small" data-action="followup-page" data-page="${reportFollowupPage+1}" ${reportFollowupPage>=followupPageCount?'disabled':''}>Sonraki →</button></div></div>`:'<div class="followup-empty"><span>✓</span><b>Bu filtrede şube bulunamadı</b><p>Başka bir durum seçerek diğer şubeleri görüntüleyebilirsin.</p></div>'}</section>
  <section class="panel"><div class="panel-head"><div><h3>Personel performansı</h3><p>Atanmış şube, fotoğraf yükleme ve onaylı tamamlama</p></div></div><div class="table-wrap"><table><thead><tr><th>PERSONEL</th><th>ATANAN ŞUBE</th><th>YÜKLEME YAPILAN</th><th>ONAYLI ŞUBE</th><th>ONAYLI TAMAMLAMA</th><th>GÖNDERİ DURUMU</th></tr></thead><tbody>${userStats.map(x=>`<tr><td><b>${esc(x.user.display_name||'İsimsiz')}</b><div class="muted">${esc(x.user.team||'Ekip belirtilmemiş')}</div></td><td>${x.assigned}</td><td>${x.uploaded}</td><td>${x.approved}</td><td style="min-width:150px"><b>%${x.rate}</b><div class="progress"><span style="width:${x.rate}%"></span></div></td><td><span class="report-approved">✓ ${x.accepted}</span> · <span class="report-pending">◷ ${x.pending}</span> · <span class="report-rejected">× ${x.rejected}</span></td></tr>`).join('')||'<tr><td colspan="6">Henüz saha personeli veya şube ataması bulunmuyor.</td></tr>'}</tbody></table></div></section>
  <section class="panel"><div class="panel-head"><div><h3>Market bazlı performans</h3><p>Her marketin atanmış şubeleri içindeki onaylı tamamlama oranı</p></div></div><div class="table-wrap"><table><thead><tr><th>MARKET</th><th>ATANMIŞ ŞUBE</th><th>YÜKLEME YAPILAN</th><th>ONAYLI ŞUBE</th><th>ONAYLI TAMAMLAMA</th><th>GÖNDERİLER</th></tr></thead><tbody>${marketStats.map(x=>`<tr><td><b>${esc(x.market.name)}</b></td><td>${x.assigned}</td><td>${x.uploaded}</td><td>${x.approved}</td><td style="min-width:150px"><b>%${x.rate}</b><div class="progress"><span style="width:${x.rate}%"></span></div></td><td>${x.rows.length} kayıt</td></tr>`).join('')||'<tr><td colspan="6">Seçili kapsamda veri bulunmuyor.</td></tr>'}</tbody></table></div></section>
  <section class="panel"><div class="panel-head"><div><h3>Fotoğraf kontrol özeti</h3><p>${selectedCampaign?esc(selectedCampaign.name):'Tüm kampanyalar'} · gönderi bazında durum</p></div></div><div class="bar-list">${[['Onaylandı',filteredSubmissions.filter(s=>s.status==='Onaylandı').length,'#2b9b6b'],['Bekliyor',filteredSubmissions.filter(s=>s.status==='Bekliyor').length,'#e2a43b'],['Reddedildi',filteredSubmissions.filter(s=>s.status==='Reddedildi').length,'#d71920']].map(([label,n,color])=>`<div><div class="bar-row-head"><span>${label}</span><span>${n} kayıt · %${Math.round(n/statusTotal*100)}</span></div><div class="bar-track"><span style="width:${Math.round(n/statusTotal*100)}%;background:${color}"></span></div></div>`).join('')}</div></section>
  <div class="hint-box">Önemli: Personel bazlı şube tamamlama hesabı, şubelerdeki sorumlu atamasına dayanır. Bir şubede sorumlu atanmamışsa o şube personel performansına yazılmaz; market ve genel toplamda atanmış şube kapsamına göre değerlendirilir. Aynı şubenin birden fazla onaylı fotoğrafı tek şube olarak sayılır.</div>`;
}
async function refreshManagedProfiles(){if(currentProfile?.role!=='admin')return;const {data,error}=await supabaseClient.functions.invoke('admin-create-user',{body:{action:'list'}});if(error)throw error;if(data?.error)throw new Error(data.error);managedProfiles=data?.users||[];}
function branchById(id){return branches.find(b=>b.id===id)}
function branchSubmissionRows(branch){const market=markets.find(m=>m.id===branch.market_id);return submissions.filter(s=>s.store===market?.name&&s.branch===branch.name)}
function openBranchDetail(id){const b=branchById(id);if(!b)return;const market=markets.find(m=>m.id===b.market_id);const assigned=new Set(branchAssignments.filter(a=>a.branch_id===b.id).map(a=>a.campaign_id));const rows=branchSubmissionRows(b);const d=$('#detailDialog');d.classList.remove('campaign-detail-dialog');d.innerHTML=`<div class="modal-head"><div><span class="eyebrow">ŞUBE DETAYI</span><h2>${esc(market?.name||'Market')} · ${esc(b.name)}</h2><p class="subheading">${esc(b.address||'Adres tanımlanmamış')}</p></div><button class="icon-button" type="button" data-close="detailDialog">×</button></div><section class="panel"><div class="panel-head"><div><h3>Kampanya atamaları</h3><p>Bu şubede uygulanması gereken kampanyaları seçin.</p></div></div>${currentProfile?.role==='admin'?`<div class="branch-campaign-checks">${campaigns.filter(c=>c.stores.includes(market?.name)||!c.stores.length).map(c=>`<label class="branch-campaign-option"><input type="checkbox" data-branch-campaign value="${c.id}" ${assigned.has(c.id)?'checked':''}/><span><b>${esc(c.name)}</b><small>${fmtDate(c.start)} – ${fmtDate(c.end)} · ${c.isActive?'Aktif':'Pasif'}</small></span></label>`).join('')||'<p>Bu market için uygun kampanya bulunmuyor.</p>'}</div><div class="modal-actions"><button class="btn btn-primary" data-action="branch-save-campaigns" data-id="${b.id}">Atamaları kaydet</button></div>`:`<p>${assigned.size} kampanya atanmış.</p>`}</section><section class="panel"><div class="panel-head"><div><h3>Sahadan afiş durumu</h3><p>Atanmış her kampanyanın son gönderimi.</p></div></div><div class="table-wrap"><table><thead><tr><th>KAMPANYA</th><th>FOTOĞRAF</th><th>DURUM</th><th>TARİH</th></tr></thead><tbody>${[...assigned].map(cid=>{const c=campaignById(cid);const r=rows.filter(x=>x.campaignId===cid).sort((a,b)=>b.date.localeCompare(a.date))[0];return `<tr><td>${esc(c.name)}</td><td>${r?.photo?'Fotoğraf eklendi':'Fotoğraf eklenmedi'}</td><td>${r?statusPill(r.status):statusPill('Bekliyor')}</td><td>${r?fmtDate(r.date):'—'}</td></tr>`}).join('')||'<tr><td colspan="4">Bu şubeye henüz kampanya atanmamış.</td></tr>'}</tbody></table></div></section>`;d.showModal()}
function openManagementForm(kind, marketId=null, branchId=null){
  if(currentProfile?.role!=='admin')return;
  let d=$('#managementDialog');
  if(!d){d=document.createElement('dialog');d.id='managementDialog';d.className='modal';document.body.appendChild(d);}
  d.classList.remove('user-create-dialog');
  const old=branchId?branchById(branchId):(kind==='market'&&marketId?markets.find(m=>m.id===marketId):null);
  const isMarket=kind==='market';
  const selectedMarket=old?.market_id||marketId||markets[0]?.id||'';
  const staff=managedProfiles.filter(u=>u.role==='field');
  d.dataset.kind=kind;d.dataset.marketId=selectedMarket;d.dataset.recordId=old?.id||'';d.dataset.mode=old?'edit':'create';
  if(isMarket){
    d.innerHTML=`<form id="managementForm"><div class="modal-head"><div><span class="eyebrow">SAHA YÖNETİMİ</span><h2>${old?'Market bilgilerini düzenle':'Yeni market ekle'}</h2><p class="subheading">Market bilgilerini buradan kaydedebilirsin.</p></div><button class="icon-button" type="button" data-close="managementDialog">×</button></div><label>Market adı<input name="name" required maxlength="100" placeholder="Örn. Migros" value="${esc(old?.name||'')}" /></label><div class="modal-actions"><button class="btn btn-quiet" type="button" data-close="managementDialog">Vazgeç</button><button class="btn btn-primary" type="submit">${old?'Değişiklikleri kaydet':'Market oluştur'}</button></div></form>`;
  }else{
    d.innerHTML=`<form id="managementForm"><div class="modal-head"><div><span class="eyebrow">ŞUBE YÖNETİMİ</span><h2>${old?'Şubeyi düzenle':'Yeni şube ekle'}</h2><p class="subheading">Market seç, şube bilgilerini doldur ve sorumlu personeli listeden ata.</p></div><button class="icon-button" type="button" data-close="managementDialog">×</button></div><label>Bağlı market<select name="market_id" required>${markets.map(m=>`<option value="${m.id}" ${m.id===selectedMarket?'selected':''}>${esc(m.name)}</option>`).join('')}</select></label><label>Şube adı<input name="name" required maxlength="120" placeholder="Örn. Çekmeköy Merkez" value="${esc(old?.name||'')}" /></label><label>Şube adresi <span class="field-hint">(İsteğe bağlı)</span><input name="address" maxlength="250" placeholder="Cadde, mahalle veya kısa adres" value="${esc(old?.address||'')}" /></label><label>Şube sorumlusu<select name="assigned_user_id"><option value="">Sorumlu atama</option>${staff.map(u=>`<option value="${u.id}" ${u.id===old?.assigned_user_id?'selected':''}>${esc(u.display_name||'İsimsiz kullanıcı')}${u.team?' · '+esc(u.team):''}</option>`).join('')}</select><small class="field-hint">${staff.length} saha personeli arasından seçim yapabilirsin. Kullanıcı ID'si girmen gerekmiyor.</small></label><div class="modal-actions"><button class="btn btn-quiet" type="button" data-close="managementDialog">Vazgeç</button><button class="btn btn-primary" type="submit">${old?'Şubeyi kaydet':'Şube oluştur'}</button></div></form>`;
  }
  d.showModal();
}
async function addOrEditMarket(id=null){openManagementForm('market',id);}
async function addOrEditBranch(marketId=null,branchId=null){if(!markets.length){toast('Önce market eklemelisin.');return}openManagementForm('branch',marketId,branchId);}
async function saveManagementForm(form){
  if(currentProfile?.role!=='admin')return;
  const d=$('#managementDialog'),kind=d.dataset.kind,recordId=d.dataset.recordId||null,f=new FormData(form),button=form.querySelector('button[type="submit"]');
  const originalButtonText=button.textContent;
  button.disabled=true;button.textContent='Kaydediliyor…';
  try{
    let result;
    if(kind==='user-create'||kind==='user'){
      const display_name=String(f.get('display_name')||'').trim();
      const role=String(f.get('role')||'field')==='admin'?'admin':'field';
      const team=String(f.get('team')||'').trim();
      const password=String(f.get('password')||'');
      const email=String(f.get('email')||'').trim().toLowerCase();
      if(!display_name)throw new Error('Ad soyad boş olamaz.');
      if(kind==='user-create'&&!email)throw new Error('E-posta adresi gereklidir.');
      if(kind==='user-create'&&password.length<8)throw new Error('Şifre en az 8 karakter olmalıdır.');
      if(password&&password.length<8)throw new Error('Şifre en az 8 karakter olmalıdır.');
      const body=kind==='user-create'?{display_name,email,password,role,team}:{action:'update',id:recordId,display_name,email,role,team,password};
      const {data,error}=await supabaseClient.functions.invoke('admin-create-user',{body});
      if(error)throw error;if(data?.error)throw new Error(data.error);
      d.close();await refreshManagedProfiles();render();toast(kind==='user-create'?'Kullanıcı hesabı oluşturuldu.':'Kullanıcı bilgileri güncellendi.');return;
    }
    if(kind==='market'){
      const name=String(f.get('name')||'').trim();if(!name)throw new Error('Market adı boş olamaz.');
      result=recordId?await supabaseClient.from('markets').update({name}).eq('id',recordId):await supabaseClient.from('markets').insert({name,created_by:currentProfile.id});
    }else{
      const market_id=String(f.get('market_id')||''),name=String(f.get('name')||'').trim(),address=String(f.get('address')||'').trim(),assigned_user_id=String(f.get('assigned_user_id')||'')||null;
      if(!market_id)throw new Error('Bir market seçmelisin.');if(!name)throw new Error('Şube adı boş olamaz.');
      const payload={market_id,name,address,assigned_user_id};
      result=recordId?await supabaseClient.from('market_branches').update({name,address,assigned_user_id,market_id}).eq('id',recordId):await supabaseClient.from('market_branches').insert({...payload,created_by:currentProfile.id}).select('*').single();
    }
    if(result.error)throw result.error;
    let branchAssignmentProblem=null;
    if(kind==='branch'&&!recordId&&result.data){try{await assignActiveCampaignsToBranch(result.data);}catch(assignmentError){branchAssignmentProblem=assignmentError;assignmentSyncWarning=assignmentError?.message||'Yeni şubeye kampanya ataması yapılamadı.';console.warn('Şube kaydedildi ancak kampanya ataması tamamlanamadı:',assignmentSyncWarning);}}
    d.close();await loadData();await refreshManagedProfiles();render();toast(branchAssignmentProblem&&assignmentSyncWarning?`Şube kaydedildi ancak kampanya ataması tamamlanamadı: ${assignmentSyncWarning}`:kind==='market'?'Market kaydedildi.':kind==='branch'&&!recordId?'Şube oluşturuldu; uygun kampanyalar otomatik atandı.':'Şube ve sorumlu ataması kaydedildi.');
  }catch(e){toast('Kayıt yapılamadı: '+(e?.message||'Beklenmeyen bir hata oluştu.'))}finally{button.disabled=false;button.textContent=originalButtonText;}
}
function confirmDeleteDialog({title,description,confirmLabel='Sil',dangerNote='Bu işlem geri alınamaz.'}){
  let d=$('#deleteConfirmDialog');
  if(!d){d=document.createElement('dialog');d.id='deleteConfirmDialog';d.className='modal delete-confirm-dialog';document.body.appendChild(d);}
  d.innerHTML=`<div class="delete-confirm-mark" aria-hidden="true">!</div><div class="modal-head"><div><span class="eyebrow">SİLME ONAYI</span><h2>${esc(title)}</h2></div><button class="icon-button" type="button" data-delete-cancel aria-label="Kapat">×</button></div><p class="delete-confirm-description">${esc(description)}</p><p class="delete-confirm-warning"><span>ⓘ</span>${esc(dangerNote)}</p><div class="modal-actions"><button class="btn btn-quiet" type="button" data-delete-cancel>Vazgeç</button><button class="btn btn-danger-soft" type="button" data-delete-confirm>${esc(confirmLabel)}</button></div>`;
  return new Promise(resolve=>{
    let settled=false;
    const finish=value=>{if(settled)return;settled=true;if(d.open)d.close();d.removeEventListener('close',onClose);resolve(value)};
    const onClose=()=>finish(false);
    d.addEventListener('close',onClose,{once:true});
    d.querySelectorAll('[data-delete-cancel]').forEach(b=>b.addEventListener('click',()=>finish(false),{once:true}));
    d.querySelector('[data-delete-confirm]').addEventListener('click',()=>finish(true),{once:true});
    d.showModal();
  });
}
async function deleteMarket(id){const m=markets.find(x=>x.id===id);if(!m||currentProfile?.role!=='admin')return;if(!await confirmDeleteDialog({title:'Market silinsin mi?',description:`${m.name} marketi ve bağlı şubeleri silmek üzeresin.`,dangerNote:'Bağlı şube ve atama kayıtları etkilenebilir. Bu işlem geri alınamaz.'}))return;const {error}=await supabaseClient.from('markets').delete().eq('id',id);if(error){toast('Market silinemedi: '+error.message);return}await loadData();render();toast('Market ve bağlı şubeleri silindi.')}
async function deleteBranch(id){const b=branchById(id);if(!b||currentProfile?.role!=='admin')return;if(!await confirmDeleteDialog({title:'Şube silinsin mi?',description:`${b.name} şubesini ve kampanya atamalarını silmek üzeresin.`,dangerNote:'Bu şubeye bağlı atama kayıtları etkilenebilir.'}))return;const {error}=await supabaseClient.from('market_branches').delete().eq('id',id);if(error){toast('Şube silinemedi: '+error.message);return}await loadData();render();toast('Şube silindi.')}
async function saveBranchCampaigns(id){if(currentProfile?.role!=='admin')return;const b=branchById(id);if(!b)return;const market=markets.find(m=>m.id===b.market_id);const chosen=$$('#detailDialog [data-branch-campaign]:checked').map(el=>el.value);const valid=chosen.filter(cid=>{const c=campaignById(cid);return !c.stores.length||c.stores.includes(market?.name)});try{const {error:deleteError}=await supabaseClient.from('campaign_branch_assignments').delete().eq('branch_id',id);if(deleteError)throw deleteError;if(valid.length){const {error}=await supabaseClient.from('campaign_branch_assignments').insert(valid.map(campaign_id=>({campaign_id,branch_id:id,assigned_by:currentProfile.id})));if(error)throw error}await loadData();openBranchDetail(id);render();toast('Şube kampanya atamaları kaydedildi.')}catch(e){toast('Atamalar kaydedilemedi: '+e.message)}}
async function editUser(id){
  if(currentProfile?.role!=='admin')return;
  const u=managedProfiles.find(x=>x.id===id);if(!u)return;
  let d=$('#managementDialog');
  if(!d){d=document.createElement('dialog');d.id='managementDialog';d.className='modal';document.body.appendChild(d);}
  d.dataset.kind='user';d.dataset.recordId=u.id;d.dataset.marketId='';
  d.classList.remove('user-create-dialog');
  d.innerHTML=`<form id="managementForm" class="management-form user-edit-form">
    <div class="modal-head"><div><span class="eyebrow">KULLANICI YÖNETİMİ</span><h2>Kullanıcıyı düzenle</h2><p class="subheading">Kullanıcı bilgilerini ve erişim rolünü buradan güncelleyebilirsin.</p></div><button class="icon-button" type="button" data-close="managementDialog" aria-label="Kapat">×</button></div>
    <div class="user-edit-summary"><div class="user-avatar">${esc((u.display_name||'K').trim().slice(0,1).toLocaleUpperCase('tr-TR'))}</div><div><b>${esc(u.display_name||'İsimsiz kullanıcı')}</b><small>Hesap bilgileri</small></div><span class="status-pill status-active">Düzenlenebilir</span></div>
    <div class="form-section-title">Temel bilgiler</div>
    <label>Ad soyad<input name="display_name" required maxlength="120" autocomplete="name" placeholder="Örn. Ahmet Yılmaz" value="${esc(u.display_name||'')}" /></label>
    <label>Giriş e-posta adresi<input name="email" type="email" required maxlength="254" autocomplete="email" placeholder="ornek@firma.com" value="${esc(u.email||'')}" /><small class="field-hint">Bu adres, kullanıcının uygulamaya giriş yaparken kullanacağı e-posta adresidir. Değişiklik sonrası yeni adresi kullanmalıdır.</small></label>
    <div class="form-grid"><label>Kullanıcı rolü<select name="role" required><option value="field" ${u.role==='field'?'selected':''}>Saha personeli</option><option value="admin" ${u.role==='admin'?'selected':''}>Yönetici</option></select><small class="field-hint">Yönetici tüm yönetim ekranlarına erişebilir.</small></label><label>Ekip adı <span class="field-hint">(İsteğe bağlı)</span><input name="team" maxlength="100" placeholder="Örn. Çekmeköy Satış Teşkilatı" value="${esc(u.team||'')}" /></label></div>
    <div class="form-section-title password-section-title">Şifre güncelleme</div>
    <label>Yeni şifre <span class="field-hint">(Değiştirmeyeceksen boş bırak)</span><input name="password" type="password" minlength="8" autocomplete="new-password" placeholder="En az 8 karakter" /><small class="field-hint">Güvenlik için mevcut şifre gösterilmez. Yalnızca yeni şifre girersen güncellenir.</small></label>
    <div class="modal-actions"><button class="btn btn-quiet" type="button" data-close="managementDialog">Vazgeç</button><button class="btn btn-primary" type="submit">Değişiklikleri kaydet</button></div>
  </form>`;
  d.showModal();
}
async function deleteUser(id){if(currentProfile?.role!=='admin')return;const u=managedProfiles.find(x=>x.id===id);if(!u||!await confirmDeleteDialog({title:'Kullanıcı silinsin mi?',description:`${u.display_name||'Bu kullanıcı'} hesabını kalıcı olarak silmek üzeresin.`,dangerNote:'Kullanıcının uygulamaya erişimi kaldırılacak.'}))return;try{const {data,error}=await supabaseClient.functions.invoke('admin-create-user',{body:{action:'delete',id}});if(error)throw error;if(data?.error)throw new Error(data.error);await refreshManagedProfiles();render();toast('Kullanıcı silindi.')}catch(e){toast('Kullanıcı silinemedi: '+e.message)}}
async function addUser(){
  if(currentProfile?.role!=='admin')return;
  let d=$('#managementDialog');
  if(!d){d=document.createElement('dialog');d.id='managementDialog';d.className='modal';document.body.appendChild(d);}
  d.dataset.kind='user-create';d.dataset.recordId='';d.dataset.marketId='';
  d.classList.add('user-create-dialog');
  d.innerHTML=`<form id="managementForm" class="management-form user-edit-form user-create-form">
    <div class="modal-head user-create-heading"><div><span class="eyebrow">ERİŞİM YÖNETİMİ</span><h2>Yeni kullanıcı oluştur</h2><p class="subheading">Hesap bilgilerini tanımla, erişim rolünü ve bağlı olduğu ekibi seç.</p></div><button class="icon-button" type="button" data-close="managementDialog" aria-label="Kapat">×</button></div>
    <div class="user-create-banner"><div class="user-avatar user-create-avatar">＋</div><div class="user-create-banner-copy"><b>Yeni hesap bilgileri</b><span>Kullanıcı giriş bilgileri oluşturulduktan sonra aktif olur.</span></div><span class="status-pill status-active">Yeni hesap</span></div>
    <section class="user-form-section"><div class="user-form-section-heading"><span class="user-form-step">01</span><div><b>Kişisel ve giriş bilgileri</b><small>Kullanıcıyı tanımlamak için gerekli alanlar</small></div></div>
      <div class="form-grid"><label>Ad soyad <span class="required-mark">*</span><input name="display_name" required maxlength="120" autocomplete="name" placeholder="Örn. Ahmet Yılmaz" /></label>
      <label>E-posta adresi <span class="required-mark">*</span><input name="email" type="email" required maxlength="254" autocomplete="email" placeholder="ornek@firma.com" /></label></div>
      <label>Geçici şifre <span class="required-mark">*</span><input name="password" type="password" required minlength="8" autocomplete="new-password" placeholder="En az 8 karakter" /><small class="field-hint">Bu şifreyle kullanıcı ilk girişini yapabilir. En az 8 karakter kullan.</small></label>
    </section>
    <section class="user-form-section"><div class="user-form-section-heading"><span class="user-form-step">02</span><div><b>Yetki ve ekip</b><small>Kullanıcının erişim düzeyini belirle</small></div></div>
      <div class="form-grid"><label>Kullanıcı rolü <span class="required-mark">*</span><select name="role" required><option value="field" selected>Saha personeli</option><option value="admin">Yönetici</option></select><small class="field-hint">Yönetici tüm yönetim ekranlarına erişebilir.</small></label>
      <label>Ekip adı <span class="field-hint">(İsteğe bağlı)</span><input name="team" maxlength="100" placeholder="Örn. Çekmeköy Satış Teşkilatı" value="${esc(currentProfile.team||'')}" /></label></div>
    </section>
    <div class="user-create-security"><span class="security-icon">✓</span><span><b>Güvenli hesap oluşturma</b><small>Hesap, yönetici doğrulaması yapan güvenli servis üzerinden oluşturulur.</small></span></div>
    <div class="modal-actions user-create-actions"><button class="btn btn-quiet" type="button" data-close="managementDialog">Vazgeç</button><button class="btn btn-primary" type="submit">＋ Kullanıcı oluştur</button></div>
  </form>`;
  d.showModal();
}
async function editCampaign(id){if(currentProfile?.role!=='admin')return;const c=campaigns.find(x=>x.id===id);if(!c)return;editingCampaignId=id;const f=$('#campaignForm');f.elements.name.value=c.name;f.elements.start.value=c.start;f.elements.end.value=c.end;f.elements.notes.value=c.notes||'';[...f.elements.stores.options].forEach(o=>o.selected=c.stores.includes(o.value));campaignExampleFile=null;$('#newCampaignExamplePreview').innerHTML=c.examplePhoto?`<img src="${c.examplePhoto}" alt="Mevcut örnek afiş"/>`:'<span>Yeni örnek afiş seçilmedi.</span>';f.querySelector('h2').textContent='Kampanyayı düzenle';f.querySelector('button[type=submit]').textContent='Değişiklikleri kaydet';f.querySelector('button[type=submit]').classList.add('btn-update-blue');openDialog('campaignDialog');}
async function deleteCampaign(id){if(currentProfile?.role!=='admin')return;const c=campaigns.find(x=>x.id===id);if(!c||!await confirmDeleteDialog({title:'Kampanya silinsin mi?',description:`“${c.name}” kampanyasını silmek üzeresin.`,dangerNote:'Kampanyayla ilişkili şube atamaları etkilenebilir.'}))return;try{const {error}=await supabaseClient.from('campaigns').delete().eq('id',id);if(error)throw error;await loadData();render();toast('Kampanya silindi.')}catch(e){toast('Kampanya silinemedi: '+e.message)}}
function openDialog(id){const d=$('#'+id);if(id==='campaignDialog'){const storeSel=$('#campaignStores');if(storeSel&&markets.length)storeSel.innerHTML=markets.filter(m=>m.is_active).map(m=>`<option value="${esc(m.name)}">${esc(m.name)}</option>`).join('');}if(id==='uploadDialog'){const sel=$('#uploadCampaign');sel.innerHTML=campaigns.filter(c=>c.isActive&&!c.expired&&c.end>=new Date().toISOString().slice(0,10)).map(c=>`<option value="${c.id}">${esc(c.name)}</option>`).join('');if(!sel.options.length){toast('Önce aktif bir kampanya oluşturmalısın.');return}renderSelectedCampaignExample();}d.showModal()}
function renderSelectedCampaignExample(){const target=$('#uploadCampaignExamplePreview');if(!target)return;const c=campaignById($('#uploadCampaign').value);target.innerHTML=c.examplePhoto?`<div class="example-reference"><b>Kampanya örnek afişi</b><img src="${c.examplePhoto}" alt="${esc(c.name)} örnek afişi"/></div>`:'<div class="example-reference example-empty">Bu kampanya için örnek afiş eklenmemiş.</div>';renderCampaignStores();}
function renderCampaignStores(preferredStore=''){const sel=$('#uploadStore');if(!sel)return;const c=campaignById($('#uploadCampaign').value);let stores=(c.stores&&c.stores.length?c.stores:markets.map(m=>m.name));stores=stores.filter(st=>markets.some(m=>m.name===st&&m.is_active));const eligible=branches.filter(b=>{const m=markets.find(x=>x.id===b.market_id);return m&&stores.includes(m.name)&&b.is_active&&(!branchAssignments.length||branchAssignments.some(a=>a.branch_id===b.id&&a.campaign_id===c.id));});const eligibleMarkets=[...new Set(eligible.map(b=>markets.find(m=>m.id===b.market_id)?.name).filter(Boolean))];if(branchAssignments.length)stores=eligibleMarkets;sel.innerHTML=stores.map(st=>`<option value="${esc(st)}">${esc(st)}</option>`).join('');if(preferredStore&&stores.includes(preferredStore))sel.value=preferredStore;const hint=$('#uploadStoreHint');if(hint)hint.textContent=`Bu kampanya için ${stores.length} hedef market tanımlı.`;renderUploadBranches();}
function renderUploadBranches(preferredBranch=''){const marketName=$('#uploadStore')?.value;const market=markets.find(m=>m.name===marketName);const sel=$('#uploadBranch');if(!sel)return;let list=branches.filter(b=>b.market_id===market?.id&&b.is_active&&(currentProfile?.role==='admin'||!b.assigned_user_id||b.assigned_user_id===currentProfile?.id));const c=campaignById($('#uploadCampaign').value);if(branchAssignments.length)list=list.filter(b=>branchAssignments.some(a=>a.branch_id===b.id&&a.campaign_id===c.id));sel.innerHTML=list.map(b=>`<option value="${esc(b.name)}">${esc(b.name)}</option>`).join('');if(preferredBranch&&list.some(b=>b.name===preferredBranch))sel.value=preferredBranch;const hint=$('#uploadBranchHint');if(hint)hint.textContent=list.length?`${list.length} kayıtlı şube bulundu.`:'Bu market/kampanya için kayıtlı şube yok. Yöneticiye şube ve kampanya ataması yaptır.';}
$('#rejectForm').addEventListener('submit',async e=>{e.preventDefault();if(!pendingRejectSubmissionId)return;const form=e.currentTarget;const reason=String(new FormData(form).get('reason')||'').trim();const note=String(new FormData(form).get('details')||'').trim();if(!reason){toast('Lütfen bir reddetme nedeni seç.');return}const reviewNote=note?`${reason} — Açıklama: ${note}`:reason;const button=form.querySelector('button[type=submit]');button.disabled=true;button.textContent='Kaydediliyor…';try{const saved=await reviewSubmission(pendingRejectSubmissionId,'reject',reviewNote);if(saved){pendingRejectSubmissionId=null;form.reset()}}finally{button.disabled=false;button.textContent='Afişi reddet'}});
$('#rejectDialog').addEventListener('close',()=>{pendingRejectSubmissionId=null});
$('#uploadCampaign').addEventListener('change',renderSelectedCampaignExample);$('#uploadStore').addEventListener('change',()=>renderUploadBranches());
function closeDialog(id){$('#'+id).close()}
let pendingRejectSubmissionId=null;
function openRejectDialog(id){if(currentProfile?.role!=='admin'){toast('Fotoğraf inceleme yetkisi yalnızca yöneticide.');return}const s=submissions.find(x=>x.id===id);if(!s||s.status!=='Bekliyor')return;pendingRejectSubmissionId=id;$('#rejectForm').reset();$('#rejectSubmissionSummary').textContent=`${s.store} · ${s.branch} — ${campaignById(s.campaignId).name}`;if($('#detailDialog').open)$('#detailDialog').close();$('#rejectDialog').showModal();}
async function reviewSubmission(id,action,reviewNote=null){if(currentProfile?.role!=='admin'){toast('Fotoğraf inceleme yetkisi yalnızca yöneticide.');return}const s=submissions.find(x=>x.id===id);if(!s)return;const status=action==='reject'?'rejected':'approved';try{const {error}=await supabaseClient.from('poster_submissions').update({status,reviewed_by:currentProfile.id,review_note:reviewNote,reviewed_at:new Date().toISOString()}).eq('id',id);if(error)throw error;const notice={user_id:s.submittedBy,title:action==='approve'?'Afişin onaylandı':'Afişin reddedildi',body:action==='approve'?'Gönderdiğin afiş yönetici tarafından onaylandı.':`Gönderdiğin afiş reddedildi. Neden: ${reviewNote}`,campaign_id:s.campaignId};const {error:noticeError}=await supabaseClient.from('notifications').insert(notice);if(noticeError)console.warn('Durum bildirimi oluşturulamadı:',noticeError.message);await loadData();await loadNotifications();if($('#detailDialog').open)$('#detailDialog').close();if($('#rejectDialog').open)$('#rejectDialog').close();render();toast(action==='approve'?'Fotoğraf onaylandı.':'Fotoğraf reddedildi; açıklama saha personeline iletildi.');return true}catch(error){toast('İşlem kaydedilemedi: '+error.message);return false}}
function openCampaignDetail(id){
  const c=campaigns.find(item=>item.id===id);if(!c)return;
  const stats=campaignStats(c);const d=$('#detailDialog');
  const marketsMarkup=(c.stores||[]).length?c.stores.map(name=>`<span class="campaign-detail-market">${esc(name)}</span>`).join(''):'<span class="muted">Hedef market belirtilmemiş</span>';
  d.classList.add('campaign-detail-dialog');
  d.innerHTML=`<div class="modal-head campaign-detail-head"><div><span class="eyebrow">KAMPANYA DETAYI</span><h2>${esc(c.name)}</h2><p class="subheading">Kampanya bilgileri ve saha ilerlemesi</p></div><button class="icon-button" type="button" data-close="detailDialog" aria-label="Kapat">×</button></div>
    ${c.examplePhoto?`<div class="campaign-detail-hero"><img src="${c.examplePhoto}" alt="${esc(c.name)} örnek afiş"/><span class="campaign-detail-hero-label">ÖRNEK AFİŞ</span></div>`:''}
    <div class="campaign-detail-stats"><article><span>Durum</span><b>${statusPill(c.status)}</b></article><article><span>İlerleme</span><b>%${campaignProgress(c)}</b><div class="progress"><span style="width:${campaignProgress(c)}%"></span></div></article><article><span>Onaylanan</span><b>${stats.approved}</b></article><article><span>Bekleyen</span><b>${stats.pending}</b></article></div>
    <section class="campaign-detail-section"><h3>Genel bilgiler</h3><div class="campaign-detail-info"><div><span>Başlangıç tarihi</span><b>${fmtDate(c.start)}</b></div><div><span>Bitiş tarihi</span><b>${fmtDate(c.end)}</b></div><div><span>Hedef market sayısı</span><b>${(c.stores||[]).length}</b></div><div><span>Reddedilen kayıt</span><b>${stats.rejected}</b></div></div></section>
    <section class="campaign-detail-section"><h3>Hedef marketler</h3><div class="campaign-detail-markets">${marketsMarkup}</div></section>
    <section class="campaign-detail-section"><h3>Kampanya notları</h3><p class="campaign-detail-notes">${esc(c.notes||'Bu kampanya için ek not bulunmuyor.')}</p></section>
    <div class="modal-actions"><button class="btn btn-quiet" type="button" data-close="detailDialog">Kapat</button>${currentProfile?.role==='admin'?`<button class="btn btn-primary" type="button" data-action="campaign-edit" data-id="${c.id}" data-close-after-edit="detailDialog">Kampanyayı düzenle</button>`:''}</div>`;
  d.showModal();
}
function detailSubmission(id){const s=submissions.find(x=>x.id===id);if(!s)return;const d=$('#detailDialog');d.classList.remove('campaign-detail-dialog');d.innerHTML=`<div class="modal-head"><div><span class="eyebrow">KAYIT DETAYI</span><h2>${esc(s.store)} · ${esc(s.branch)}</h2></div><button class="icon-button" type="button" data-close="detailDialog">×</button></div>${s.photo?`<img src="${s.photo}" style="width:100%;max-height:300px;object-fit:contain;background:#f4f5f7;border-radius:10px;margin-bottom:16px"/>`:'<div class="photo-preview" style="height:150px">Fotoğraf eklenmemiş demo kaydı</div>'}<p><b>Kampanya:</b> ${esc(campaignById(s.campaignId).name)}</p><p><b>Personel:</b> ${esc(s.person)}</p><p><b>Tarih:</b> ${fmtDate(s.date)}</p><p><b>Durum:</b> ${statusPill(s.status)}</p><p><b>Gönderi notu:</b> ${esc(s.note||'Not eklenmedi')}</p>${s.reviewNote?`<div class="rejection-note"><b>Yönetici açıklaması:</b> ${esc(s.reviewNote)}</div>`:''}<div class="modal-actions">${currentProfile?.role==='admin'&&s.status==='Bekliyor'?`<button class="btn btn-danger-soft" data-action="reject" data-id="${s.id}">Reddet</button><button class="btn btn-approved" data-action="approve" data-id="${s.id}">✓ Onayla</button>`:''}${currentProfile?.role!=='admin'&&s.status==='Reddedildi'?`<button class="btn btn-primary" data-action="resubmit" data-id="${s.id}">↻ Yeniden gönder</button>`:''}<button class="btn btn-quiet" data-close="detailDialog">Kapat</button></div>`;d.showModal()}
function exportCSV(){const rows=[['Market','Şube','Kampanya','Personel','Tarih','Durum','Not'],...submissions.map(s=>[s.store,s.branch,campaignById(s.campaignId).name,s.person,s.date,s.status,s.note||''])];const csv='\ufeff'+rows.map(r=>r.map(v=>'"'+String(v).replaceAll('"','""')+'"').join(';')).join('\r\n');const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8;'}));const a=document.createElement('a');a.href=url;a.download='algida-afis-raporu.csv';a.click();URL.revokeObjectURL(url);toast('CSV raporu indiriliyor.');}
async function handleAction(action,id){
  if(action==='campaign'){if(currentProfile?.role!=='admin'){toast('Bu işlem için yönetici yetkisi gerekir.');return}editingCampaignId=null;$('#campaignForm').reset();$('#campaignForm').querySelector('h2').textContent='Kampanya oluştur';$('#campaignForm button[type=submit]').textContent='Kampanyayı oluştur';$('#campaignForm button[type=submit]').classList.remove('btn-update-blue');openDialog('campaignDialog')}
  if(action==='campaign-edit')editCampaign(id);
  if(action==='campaign-delete')await deleteCampaign(id);
  if(action==='market-add')await addOrEditMarket();
  if(action==='market-edit')await addOrEditMarket(id);
  if(action==='market-delete')await deleteMarket(id);
  if(action==='branch-add')await addOrEditBranch(id);
  if(action==='branch-add-select')await addOrEditBranch();
  if(action==='branch-edit')await addOrEditBranch(null,id);
  if(action==='branch-delete')await deleteBranch(id);
  if(action==='branch-detail')openBranchDetail(id);
  if(action==='branch-save-campaigns')await saveBranchCampaigns(id);
  if(action==='user-add')await addUser();
  if(action==='user-edit')await editUser(id);
  if(action==='user-delete')await deleteUser(id);
  if(action==='users-refresh'){try{await refreshManagedProfiles();render();}catch(e){toast('Kullanıcılar yüklenemedi: '+e.message)}}
  if(action==='upload')openDialog('uploadDialog');
  if(action==='resubmit'){const s=submissions.find(x=>x.id===id);if(!s||s.status!=='Reddedildi'||currentProfile?.role==='admin')return;openDialog('uploadDialog');$('#uploadCampaign').value=s.campaignId;renderSelectedCampaignExample();renderCampaignStores(s.store);$('#uploadForm').elements.branch.value=s.branch;$('#uploadForm').elements.note.value=s.reviewNote?`Önceki ret nedeni: ${s.reviewNote}`:'';$('#uploadForm').elements.photo.value='';selectedPhoto=null;$('#photoPreview').innerHTML='<span>Düzeltilmiş fotoğrafı seç.</span>';}
  if(action==='campaign-detail')openCampaignDetail(id);
  if(action==='submission-detail')detailSubmission(id);
  if(action==='reject'){openRejectDialog(id);return}
  if(action==='approve'){await reviewSubmission(id,'approve');return}
  if(action==='enable-notifications'){await enablePushNotifications();}
  if(action==='mark-notifications-read'){const {error}=await supabaseClient.from('notifications').update({is_read:true}).eq('user_id',currentProfile.id).eq('is_read',false);if(error){toast('Bildirimler güncellenemedi: '+error.message);return}notifications=notifications.map(n=>({...n,is_read:true}));await loadNotifications();if($('#notificationsDialog').open)openNotifications();toast('Bildirimler okundu olarak işaretlendi.')}
  if(action==='export')exportCSV();
}
function closeSidebar(){ $('#sidebar').classList.remove('open');$('#sidebarBackdrop').hidden=true;$('#menuToggle').setAttribute('aria-expanded','false');}
function toggleSidebar(){if(window.matchMedia('(max-width: 800px)').matches){const open=!$('#sidebar').classList.contains('open');$('#sidebar').classList.toggle('open',open);$('#sidebarBackdrop').hidden=!open;$('#menuToggle').setAttribute('aria-expanded',String(open));}else{const collapsed=document.body.classList.toggle('sidebar-collapsed');$('#menuToggle').setAttribute('aria-expanded',String(!collapsed));try{localStorage.setItem('algida-sidebar-collapsed',String(collapsed))}catch(e){}}}
function initSidebar(){try{if(localStorage.getItem('algida-sidebar-collapsed')==='true'&&!window.matchMedia('(max-width: 800px)').matches)document.body.classList.add('sidebar-collapsed')}catch(e){}$$('.nav-item').forEach(item=>{if(!item.title)item.title=item.textContent.trim().replace(/\s+/g,' ')});const brand=$('#sidebar .brand');if(brand){brand.addEventListener('click',e=>{e.preventDefault();activeView='dashboard';closeSidebar();render();});}const menu=$('#menuToggle');if(menu){menu.classList.remove('mobile-only');menu.setAttribute('aria-label','Yan paneli aç veya kapat');menu.title='Yan paneli aç/kapat';menu.addEventListener('click',toggleSidebar);}}
document.addEventListener('click',e=>{const nav=e.target.closest('[data-view]');if(nav){activeView=nav.dataset.view;closeSidebar();render();return}const act=e.target.closest('[data-action]');if(act){if(act.dataset.action==='followup-filter'){reportFollowupFilter=act.dataset.filter||'all';reportFollowupPage=1;render();return}if(act.dataset.action==='followup-page'){const page=Number(act.dataset.page);if(Number.isFinite(page)&&page>=1){reportFollowupPage=page;render()}return}if(act.dataset.action==='campaign-filter-reset'){campaignDateFrom='';campaignDateTo='';campaignMarketFilter='all';render();return}if(act.dataset.action==='stores-filter-reset'){storesSearch='';storesMarketFilter='all';render();return}if(act.dataset.action==='stores-market-select'){storesMarketFilter=act.dataset.id;storesSearch='';render();return}handleAction(act.dataset.action,act.dataset.id);return}const filter=e.target.closest('[data-filter]');if(filter){submissionFilter=filter.dataset.filter;render();return}const close=e.target.closest('[data-close]');if(close){closeDialog(close.dataset.close);return}});
initSidebar();
$('#sidebarBackdrop').addEventListener('click',closeSidebar);
document.addEventListener('keydown',e=>{if(e.key==='Escape')closeSidebar();});
$('#notificationsBtn').addEventListener('click',openNotifications);
document.addEventListener('submit',e=>{if(e.target?.id==='managementForm'){e.preventDefault();saveManagementForm(e.target);}});
async function reconcileCampaignAssignments(){
  assignmentSyncWarning='';
  if(currentProfile?.role!=='admin'||!campaigns.length||!branches.length)return;
  const normalize=value=>String(value||'').trim().toLocaleLowerCase('tr-TR');
  const wanted=[];
  for(const campaign of campaigns){
    if(!campaign.isActive||campaign.expired)continue;
    const selectedNames=new Set((campaign.stores||[]).map(normalize));
    const marketIds=markets.filter(m=>selectedNames.has(normalize(m.name))).map(m=>m.id);
    for(const branch of branches){
      if(marketIds.includes(branch.market_id)&&!branchAssignments.some(a=>a.campaign_id===campaign.id&&a.branch_id===branch.id))wanted.push({campaign_id:campaign.id,branch_id:branch.id,assigned_by:currentProfile.id});
    }
  }
  if(!wanted.length)return;
  try{
    for(let i=0;i<wanted.length;i+=100){
      const batch=wanted.slice(i,i+100);
      const {error}=await supabaseClient.from('campaign_branch_assignments').insert(batch);
      if(error)throw error;
    }
    branchAssignments=[...branchAssignments,...wanted.map(({campaign_id,branch_id,assigned_by})=>({campaign_id,branch_id,assigned_by}))];
  }catch(error){assignmentSyncWarning=error?.message||'Kampanya atamaları yazılamadı.';console.warn('Otomatik kampanya atama kontrolü başarısız:',assignmentSyncWarning);}
}
async function syncCampaignBranchAssignments(campaignId, storeNames, {removeOutside=false}={}){
  const normalize=value=>String(value||'').trim().toLocaleLowerCase('tr-TR');
  const wantedNames=new Set((storeNames||[]).map(normalize));
  const targetMarketIds=markets.filter(m=>wantedNames.has(normalize(m.name))).map(m=>m.id);
  const targetBranchIds=branches.filter(b=>targetMarketIds.includes(b.market_id)).map(b=>b.id);
  const {data:existing,error:readError}=await supabaseClient.from('campaign_branch_assignments').select('branch_id').eq('campaign_id',campaignId);
  if(readError)throw readError;
  const existingIds=new Set((existing||[]).map(a=>a.branch_id));
  const missing=targetBranchIds.filter(id=>!existingIds.has(id));
  for(let i=0;i<missing.length;i+=100){const batch=missing.slice(i,i+100).map(branch_id=>({campaign_id,branch_id,assigned_by:currentProfile.id}));const {error}=await supabaseClient.from('campaign_branch_assignments').insert(batch);if(error)throw error;}
  if(removeOutside){
    const outside=(existing||[]).map(a=>a.branch_id).filter(id=>!targetBranchIds.includes(id));
    for(const branchId of outside){const {error}=await supabaseClient.from('campaign_branch_assignments').delete().eq('campaign_id',campaignId).eq('branch_id',branchId);if(error)throw error;}
  }
  return targetBranchIds.length;
}
async function assignActiveCampaignsToBranch(branch){
  const market=markets.find(m=>m.id===branch.market_id);if(!market)return 0;
  const today=new Date().toISOString().slice(0,10);
  const normalize=value=>String(value||'').trim().toLocaleLowerCase('tr-TR');
  const active=campaigns.filter(c=>c.isActive&&!c.expired&&c.start<=today&&c.end>=today&&(c.stores||[]).some(name=>normalize(name)===normalize(market.name))); 
  if(!active.length)return 0;
  const {data:existing,error:readError}=await supabaseClient.from('campaign_branch_assignments').select('campaign_id').eq('branch_id',branch.id);
  if(readError)throw readError;
  const existingIds=new Set((existing||[]).map(a=>a.campaign_id));
  const missing=active.filter(c=>!existingIds.has(c.id));
  if(missing.length){const {error}=await supabaseClient.from('campaign_branch_assignments').insert(missing.map(c=>({campaign_id:c.id,branch_id:branch.id,assigned_by:currentProfile.id})));if(error)throw error;}
  return missing.length;
}
$('#campaignForm').addEventListener('submit',async e=>{e.preventDefault();if(currentProfile?.role!=='admin'){toast('Kampanya oluşturma yetkisi yalnızca yöneticide.');return}const form=e.currentTarget,f=new FormData(form);const start=f.get('start'),end=f.get('end');if(end<start){toast('Bitiş tarihi başlangıç tarihinden önce olamaz.');return}const selected=[...form.elements.stores.selectedOptions].map(o=>o.value);const button=form.querySelector('button[type=submit]');button.disabled=true;button.textContent='Kaydediliyor…';let examplePath=null;try{if(campaignExampleFile){if(campaignExampleFile.size>8*1024*1024)throw new Error('Örnek fotoğraf 8 MB altında olmalı.');const ext=(campaignExampleFile.name.split('.').pop()||'jpg').toLowerCase().replace(/[^a-z0-9]/g,'')||'jpg';examplePath=`${currentProfile.id}/campaign-examples/${crypto.randomUUID()}.${ext}`;const {error:photoError}=await supabaseClient.storage.from('poster-photos').upload(examplePath,campaignExampleFile,{contentType:campaignExampleFile.type||'image/jpeg',upsert:false});if(photoError)throw photoError;}const payload={name:String(f.get('name')).trim(),starts_on:start,ends_on:end,stores:selected.length?selected:markets.filter(m=>m.is_active).map(m=>m.name),notes:String(f.get('notes')||'').trim(),is_active:true,created_by:currentProfile.id};if(examplePath)payload.example_photo_path=examplePath;let created,error;if(editingCampaignId){const result=await supabaseClient.from('campaigns').update({name:payload.name,starts_on:payload.starts_on,ends_on:payload.ends_on,stores:payload.stores,notes:payload.notes,...(examplePath?{example_photo_path:examplePath}:{})}).eq('id',editingCampaignId).select('id,name').single();created=result.data;error=result.error;}else{const result=await supabaseClient.from('campaigns').insert(payload).select('id,name').single();created=result.data;error=result.error;}if(error)throw error;let assignmentProblem=null;try{await syncCampaignBranchAssignments(created.id,payload.stores,{removeOutside:!!editingCampaignId});}catch(assignmentError){assignmentProblem=assignmentError;assignmentSyncWarning=assignmentError?.message||'Kampanya şube atamaları tamamlanamadı.';console.warn('Kampanya kaydedildi ancak şube atamaları tamamlanamadı:',assignmentSyncWarning);}const {data:teamProfiles,error:profilesError}=await supabaseClient.from('profiles').select('id,team').eq('role','field');if(profilesError)throw profilesError;const recipients=(teamProfiles||[]).filter(profile=>currentProfile.team?profile.team===currentProfile.team:true);if(recipients.length){const message={title:'Yeni kampanya yayınlandı',body:`${payload.name} kampanyası yayında. Örnek afişi inceleyip saha uygulamasını başlatabilirsin.`,campaign_id:created.id};const {error:notifyError}=await supabaseClient.from('notifications').insert(recipients.map(profile=>({...message,user_id:profile.id})));if(notifyError)console.warn('Kampanya kaydedildi ancak ekip bildirimi oluşturulamadı:',notifyError.message);}await loadData();await loadNotifications();closeDialog('campaignDialog');form.reset();campaignExampleFile=null;$('#newCampaignExamplePreview').innerHTML='<span>Örnek afiş seçilmedi.</span>';render();editingCampaignId=null;toast(assignmentProblem&&assignmentSyncWarning?`Kampanya kaydedildi ancak şube ataması tamamlanamadı: ${assignmentSyncWarning}`:`Kampanya kaydedildi. ${recipients.length} saha personeline bildirim oluşturuldu.`)}catch(error){if(examplePath)await supabaseClient.storage.from('poster-photos').remove([examplePath]);toast('Kampanya kaydedilemedi: '+error.message)}finally{button.disabled=false;button.textContent='Kampanyayı oluştur'}});
$('#campaignForm').elements.examplePhoto.addEventListener('change',e=>{campaignExampleFile=e.target.files[0]||null;const preview=$('#newCampaignExamplePreview');if(!campaignExampleFile){preview.innerHTML='<span>Örnek afiş seçilmedi.</span>';return}if(campaignExampleFile.size>8*1024*1024){toast('Örnek fotoğraf 8 MB altında olmalı.');e.target.value='';campaignExampleFile=null;preview.innerHTML='<span>Örnek afiş seçilmedi.</span>';return}const reader=new FileReader();reader.onload=()=>{preview.innerHTML=`<img src="${reader.result}" alt="Kampanya örnek afişi önizlemesi"/>`};reader.readAsDataURL(campaignExampleFile)});
let photoData=null;$('#uploadForm').elements.photo.addEventListener('change',e=>{const file=e.target.files[0];selectedPhoto=file||null;if(!file){photoData=null;return}if(file.size>8*1024*1024){toast('Fotoğraf 8 MB altında olmalı.');e.target.value='';selectedPhoto=null;photoData=null;return}const reader=new FileReader();reader.onload=()=>{photoData=reader.result;$('#photoPreview').innerHTML=`<img src="${photoData}" alt="Fotoğraf önizlemesi"/>`};reader.readAsDataURL(file)});
$('#uploadForm').addEventListener('submit',async e=>{e.preventDefault();const form=e.currentTarget,f=new FormData(form);if(!selectedPhoto){toast('Lütfen fotoğraf seç.');return}if(!currentProfile){toast('Oturum bilgisi bulunamadı; yeniden giriş yap.');return}const selectedCampaign=campaignById(String(f.get('campaign')));const selectedStore=String(f.get('store'));const selectedBranch=String(f.get('branch'));if(!selectedCampaign.isActive||selectedCampaign.expired||selectedCampaign.end<new Date().toISOString().slice(0,10)||!(selectedCampaign.stores||markets.map(m=>m.name)).includes(selectedStore)){toast('Kampanya pasif veya süresi dolmuş. Fotoğraf yüklenemez.');return}if(!branches.some(b=>b.name===selectedBranch&&markets.find(m=>m.id===b.market_id)?.name===selectedStore&&(currentProfile?.role==='admin'||!b.assigned_user_id||b.assigned_user_id===currentProfile.id))){toast('Bu market için kayıtlı bir şube seçmelisin. Yöneticiye başvur.');return}if(branchAssignments.length&&!branchAssignments.some(a=>a.branch_id===branches.find(b=>b.name===selectedBranch&&markets.find(m=>m.id===b.market_id)?.name===selectedStore)?.id&&a.campaign_id===selectedCampaign.id)){toast('Bu şubeye seçili kampanya tanımlanmamış.');return}const button=form.querySelector('button[type=submit]');button.disabled=true;button.textContent='Yükleniyor…';let path=null;try{const ext=(selectedPhoto.name.split('.').pop()||'jpg').toLowerCase().replace(/[^a-z0-9]/g,'')||'jpg';path=`${currentProfile.id}/${crypto.randomUUID()}.${ext}`;const {error:uploadError}=await supabaseClient.storage.from('poster-photos').upload(path,selectedPhoto,{contentType:selectedPhoto.type||'image/jpeg',upsert:false});if(uploadError)throw uploadError;const {error:insertError}=await supabaseClient.from('poster_submissions').insert({campaign_id:String(f.get('campaign')),store:String(f.get('store')),branch:String(f.get('branch')).trim(),photo_path:path,note:String(f.get('note')||'').trim(),submitted_by:currentProfile.id});if(insertError){await supabaseClient.storage.from('poster-photos').remove([path]);throw insertError}await loadData();closeDialog('uploadDialog');form.reset();selectedPhoto=null;photoData=null;$('#photoPreview').innerHTML='<span>Fotoğraf seçildiğinde önizleme burada görünür.</span>';render();toast('Fotoğraf ve kayıt Supabase’e yüklendi.')}catch(error){toast('Fotoğraf kaydedilemedi: '+error.message)}finally{button.disabled=false;button.textContent='İncelemeye gönder'}});
$('#helpBtn').addEventListener('click',()=>alert('Algida Saha · Supabase bağlantılı sürüm\n\nKampanyalar, afiş kayıtları ve inceleme durumları Supabase üzerinde saklanır. Fotoğraflar özel Storage alanında tutulur.')); 
window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();deferredInstall=e;$('#installBtn').hidden=false});$('#installBtn').addEventListener('click',async()=>{if(!deferredInstall){toast('Tarayıcı menüsünden Ana Ekrana Ekle seçeneğini kullan.');return}deferredInstall.prompt();await deferredInstall.userChoice;deferredInstall=null;$('#installBtn').hidden=true});
if('serviceWorker' in navigator && location.protocol!=='file:'){window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js').catch(()=>{}))}


$('#appContent').addEventListener('change',e=>{if(e.target.id==='performanceCampaignFilter'){reportFollowupPage=1;render();return}if(e.target.id==='reportStaffFilter'){reportStaffFilter=e.target.value;reportFollowupPage=1;render();return}if(e.target.id==='campaignDateFrom'){const next=e.target.value;if(next&&campaignDateTo&&next>campaignDateTo){toast('Başlangıç tarihi bitiş tarihinden sonra olamaz.');render();return}campaignDateFrom=next;render();return}if(e.target.id==='campaignDateTo'){const next=e.target.value;if(next&&campaignDateFrom&&next<campaignDateFrom){toast('Bitiş tarihi başlangıç tarihinden önce olamaz.');render();return}campaignDateTo=next;render();return}if(e.target.id==='campaignMarketFilter'){campaignMarketFilter=e.target.value;render();return}if(e.target.id==='storesMarketFilter'){storesMarketFilter=e.target.value;render();return}if(e.target.id==='storesSearch'){storesSearch=e.target.value;render();}});
$('#appContent').addEventListener('keydown',e=>{if(e.target.id==='storesSearch'&&e.key==='Enter'){e.preventDefault();storesSearch=e.target.value;render();}});
// Supabase Auth, campaigns, photo submissions and in-app team notifications.
const authGate=$('#authGate'), appShell=$('#appShell'), loginForm=$('#loginForm'), authMessage=$('#authMessage');
function setAuthMessage(message,success=false){authMessage.textContent=message;authMessage.classList.toggle('success',success)}
function showLogin(){authGate.hidden=false;appShell.hidden=true;initTheme()}
async function showApp(session){
  try{
    const {data,error}=await supabaseClient.from('profiles').select('id,display_name,role,team').eq('id',session.user.id).single();
    if(error) throw error;
    currentProfile=data;
    if(!['admin','field'].includes(data.role)) throw new Error('Hesabın için geçerli bir rol tanımlı değil. Yöneticine başvur.');
    authGate.hidden=true;appShell.hidden=false;
    $('#userDisplayName').textContent=data.display_name||session.user.email||'Kullanıcı';
    $('#userRoleLabel').textContent=(data.role==='admin'?'Yönetici':'Saha personeli')+(data.team?' · '+data.team:'');
    $('#userAvatar').textContent=(data.display_name||session.user.email||'A').slice(0,2).toLocaleUpperCase('tr-TR');
    await loadData();
    if(data.role==='admin'){try{await refreshManagedProfiles()}catch(e){console.warn('Kullanıcı listesi alınamadı:',e.message)}}
    await loadNotifications({notifyNew:false});
    if(!notificationTimer)notificationTimer=setInterval(()=>{if(currentProfile)loadNotifications({notifyNew:true}).catch(()=>{});},30000);
    // RLS remains the security boundary; field users can see their own submission statuses.
    $$('[data-view="reports"]').forEach(el=>el.hidden=data.role!=='admin');$$('[data-admin-only]').forEach(el=>el.hidden=data.role!=='admin');
    $$('[data-action="campaign"]').forEach(el=>el.hidden=data.role!=='admin');
    $('#sidebar .sidebar-bottom span').textContent='Supabase · Canlı veri';
    if(data.role!=='admin' && ['submissions','reports','users'].includes(activeView)) activeView='dashboard';
    render();
  }catch(error){
    await supabaseClient.auth.signOut();showLogin();
    setAuthMessage('Profil okunamadı: '+(error.message||'Bilinmeyen hata')+' — profiles tablosundaki kullanıcı kaydını kontrol et.');
  }
}
loginForm.addEventListener('submit',async e=>{
  e.preventDefault();if(!supabaseClient){setAuthMessage('Supabase yapılandırması bulunamadı. supabase-config.js dosyasını kontrol et.');return}
  const button=loginForm.querySelector('button[type="submit"]');button.disabled=true;button.textContent='Giriş yapılıyor…';setAuthMessage('');
  const form=new FormData(loginForm);
  try{const {data,error}=await supabaseClient.auth.signInWithPassword({email:String(form.get('email')).trim(),password:String(form.get('password'))});if(error)throw error;if(data.session)await showApp(data.session)}
  catch(error){setAuthMessage(error.message||'Giriş yapılamadı. E-posta ve şifreni kontrol et.')}
  finally{button.disabled=false;button.textContent='Giriş yap'}
});
$('#logoutBtn').addEventListener('click',async()=>{if(!supabaseClient)return;const {error}=await supabaseClient.auth.signOut();if(error){toast('Çıkış yapılamadı: '+error.message);return}currentProfile=null;showLogin();loginForm.reset();setAuthMessage('Güvenli çıkış yapıldı.',true)});
$('#forgotPasswordBtn').addEventListener('click',async()=>{
  if(!supabaseClient){setAuthMessage('Önce Supabase yapılandırmasını kontrol et.');return}
  const email=String(new FormData(loginForm).get('email')||'').trim();if(!email){setAuthMessage('Şifre sıfırlama bağlantısı için önce e-posta adresini yaz.');return}
  const redirectTo=location.origin+location.pathname;
  const {error}=await supabaseClient.auth.resetPasswordForEmail(email,{redirectTo});
  setAuthMessage(error?error.message:'Eğer bu e-posta kayıtlıysa şifre sıfırlama bağlantısı gönderildi.',!error);
});
(async function initSupabaseAuth(){
  if(!window.supabase||!window.SUPABASE_URL||!window.SUPABASE_ANON_KEY||window.SUPABASE_URL.includes('BURAYA')||window.SUPABASE_ANON_KEY.includes('BURAYA')){
    showLogin();setAuthMessage('Bağlantı ayarları eksik. supabase-config.js içinde Project URL ve Publishable/anon public key değerlerini kontrol et.');return;
  }
  try{
    supabaseClient=window.supabase.createClient(window.SUPABASE_URL,window.SUPABASE_ANON_KEY);
    const {data:{session},error}=await supabaseClient.auth.getSession();if(error)throw error;
    if(session)await showApp(session);else showLogin();
    supabaseClient.auth.onAuthStateChange((_event,newSession)=>{if(newSession)showApp(newSession);else{currentProfile=null;showLogin()}});
  }catch(error){showLogin();setAuthMessage('Supabase bağlantı hatası: '+(error.message||'Ayarları kontrol et.'))}
})();
