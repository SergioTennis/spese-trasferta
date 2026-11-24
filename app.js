import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import { getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import { getFirestore, collection, doc, setDoc, onSnapshot, serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';

const config = {
  apiKey: 'AIzaSyCXYiGBlj7lT7dpFUc9yyWXQgbvLoDezeQ',
  authDomain: 'spese-trasferta.firebaseapp.com',
  projectId: 'spese-trasferta',
  storageBucket: 'spese-trasferta.firebasestorage.app',
  messagingSenderId: '653634541256',
  appId: '1:653634541256:web:738d5d86b78623a20cb7fd'
};

const fb = initializeApp(config);
const auth = getAuth(fb);
const db = getFirestore(fb);
const $ = (s) => document.querySelector(s);
let view = new Date();
let selected = new Date();
let days = {};
let pending = [];
let unsub = null;
let user = null;
let previewUrl = null;

const key = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const eur = (n) => Number(n || 0).toLocaleString('it-IT', { style: 'currency', currency: 'EUR' });
const newId = () => crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`;
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

function openIDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('SpeseTrasferta', 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains('files')) {
        request.result.createObjectStore('files', { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function storeFiles(expenseId, files) {
  if (!files.length) return;
  const database = await openIDB();
  try {
    await new Promise((resolve, reject) => {
      const tx = database.transaction('files', 'readwrite');
      const store = tx.objectStore('files');
      files.forEach((file) => store.put({
        id: `${expenseId}:${newId()}`,
        expenseId,
        name: file.name || 'giustificativo',
        type: file.type || 'application/octet-stream',
        size: file.size,
        blob: file
      }));
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    database.close();
  }
}

async function getFiles(expenseId) {
  const database = await openIDB();
  try {
    return await new Promise((resolve, reject) => {
      const tx = database.transaction('files', 'readonly');
      const request = tx.objectStore('files').getAll();
      request.onsuccess = () => resolve(request.result.filter((item) => item.expenseId === expenseId));
      request.onerror = () => reject(request.error);
    });
  } finally {
    database.close();
  }
}

async function deleteFiles(expenseId) {
  const database = await openIDB();
  try {
    const files = await new Promise((resolve, reject) => {
      const tx = database.transaction('files', 'readonly');
      const request = tx.objectStore('files').getAll();
      request.onsuccess = () => resolve(request.result.filter((item) => item.expenseId === expenseId));
      request.onerror = () => reject(request.error);
    });
    await new Promise((resolve, reject) => {
      const tx = database.transaction('files', 'readwrite');
      files.forEach((item) => tx.objectStore('files').delete(item.id));
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    database.close();
  }
}

function closePreview() {
  $('#preview').classList.add('hidden');
  $('#previewBody').innerHTML = '';
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = null;
}

async function showAttachments(expenseId) {
  const body = $('#previewBody');
  $('#previewTitle').textContent = 'Giustificativi';
  body.innerHTML = '<p>Caricamento…</p>';
  $('#preview').classList.remove('hidden');
  try {
    const files = await getFiles(expenseId);
    if (!files.length) {
      body.innerHTML = '<p>Il giustificativo non è disponibile su questo dispositivo.</p>';
      return;
    }
    body.innerHTML = '';
    files.forEach((file, index) => {
      const section = document.createElement('section');
      section.className = 'preview-file';
      const title = document.createElement('strong');
      title.textContent = file.name;
      section.appendChild(title);
      const url = URL.createObjectURL(file.blob);
      if (index === 0) previewUrl = url;
      if ((file.type || '').startsWith('image/')) {
        const img = document.createElement('img');
        img.src = url;
        img.alt = file.name;
        section.appendChild(img);
      } else if (file.type === 'application/pdf') {
        const frame = document.createElement('iframe');
        frame.src = url;
        frame.title = file.name;
        section.appendChild(frame);
      }
      const link = document.createElement('a');
      link.href = url;
      link.target = '_blank';
      link.rel = 'noopener';
      link.download = file.name;
      link.textContent = 'Apri o scarica il file';
      section.appendChild(link);
      body.appendChild(section);
    });
  } catch (error) {
    body.innerHTML = '<p>Impossibile aprire il giustificativo.</p>';
  }
}


function monthRecords() {
  const prefix = `${view.getFullYear()}-${String(view.getMonth() + 1).padStart(2, '0')}-`;
  const rows = [];
  Object.entries(days).filter(([date]) => date.startsWith(prefix)).sort(([a],[b]) => a.localeCompare(b)).forEach(([date, record]) => {
    (record.items || []).forEach((item) => rows.push({date, job: record.job || '', notes: record.notes || '', ...item}));
  });
  return rows;
}
function monthlyHtml() {
  const rows = monthRecords();
  const title = new Intl.DateTimeFormat('it-IT',{month:'long',year:'numeric'}).format(view);
  const priv = rows.filter(x=>x.private).reduce((a,x)=>a+x.amount,0);
  const corp = rows.filter(x=>!x.private).reduce((a,x)=>a+x.amount,0);
  const body = rows.length ? rows.map(x=>`<tr><td>${esc(new Date(x.date+'T12:00:00').toLocaleDateString('it-IT'))}</td><td>${esc(x.type)}</td><td>${esc(x.job)}</td><td>${x.private?'Privata':'Aziendale'}</td><td class="money">${eur(x.amount)}</td><td>${x.attachmentCount||0}</td></tr>`).join('') : '<tr><td colspan="6">Nessuna spesa nel mese.</td></tr>';
  return `<div class="summary-sheet"><h1>Spese di trasferta</h1><h3>${esc(title)}</h3><table><thead><tr><th>Data</th><th>Tipologia</th><th>Commessa</th><th>Carta</th><th>Importo</th><th>Giust.</th></tr></thead><tbody>${body}</tbody></table><div class="summary-totals"><p>Carta privata <strong>${eur(priv)}</strong></p><p>Carta aziendale <strong>${eur(corp)}</strong></p><p class="summary-grand">Totale mese <strong>${eur(priv+corp)}</strong></p></div></div>`;
}
function showMonthly(){ $('#monthlyBody').innerHTML=monthlyHtml(); $('#monthly').classList.remove('hidden'); }
function closeMonthly(){ $('#monthly').classList.add('hidden'); }
$('#summary').onclick=showMonthly;
$('#closeMonthly').onclick=closeMonthly;
$('#monthly').onclick=e=>{if(e.target===$('#monthly')) closeMonthly()};

function safePdfName(value){return String(value||'').replace(/[^a-zA-Z0-9._-]+/g,'-').replace(/^-+|-+$/g,'')||'file'}
function wrapPdfText(text,font,size,maxWidth){
  const words=String(text||'').split(/\s+/).filter(Boolean), lines=[]; let line='';
  for(const word of words){const test=line?`${line} ${word}`:word;if(font.widthOfTextAtSize(test,size)<=maxWidth)line=test;else{if(line)lines.push(line);line=word}}
  if(line)lines.push(line); return lines.length?lines:[''];
}
async function imageBlobToJpegBytes(blob){
  const url=URL.createObjectURL(blob);
  try{
    const img=await new Promise((ok,no)=>{const x=new Image();x.onload=()=>ok(x);x.onerror=no;x.src=url});
    const max=1800,scale=Math.min(1,max/Math.max(img.naturalWidth,img.naturalHeight));
    const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(img.naturalWidth*scale));canvas.height=Math.max(1,Math.round(img.naturalHeight*scale));
    canvas.getContext('2d',{alpha:false}).drawImage(img,0,0,canvas.width,canvas.height);
    const out=await new Promise((ok)=>canvas.toBlob(ok,'image/jpeg',0.86));
    if(!out)throw new Error('Conversione immagine non riuscita');
    return new Uint8Array(await out.arrayBuffer());
  }finally{URL.revokeObjectURL(url)}
}
async function createPdfWithReceipts(){
  const button=$('#pdfWithReceipts'), old=button.textContent; button.disabled=true; button.textContent='Creazione PDF…';
  try{
    const {PDFDocument,StandardFonts,rgb}=await import('https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/+esm');
    const pdf=await PDFDocument.create(), font=await pdf.embedFont(StandardFonts.Helvetica), bold=await pdf.embedFont(StandardFonts.HelveticaBold);
    const rows=monthRecords(), monthLabel=new Intl.DateTimeFormat('it-IT',{month:'long',year:'numeric'}).format(view);
    const priv=rows.filter(x=>x.private).reduce((a,x)=>a+x.amount,0),corp=rows.filter(x=>!x.private).reduce((a,x)=>a+x.amount,0);
    const addSummaryPage=()=>{const page=pdf.addPage([595.28,841.89]);return {page,y:800}};
    let {page,y}=addSummaryPage();
    page.drawText('Spese di trasferta',{x:40,y,font:bold,size:20,color:rgb(.08,.18,.32)});y-=26;
    page.drawText(monthLabel,{x:40,y,font,size:12,color:rgb(.3,.38,.48)});y-=28;
    const headers=['Data','Tipologia','Commessa','Carta','Importo','Giust.'], xs=[40,95,205,345,420,505];
    headers.forEach((h,i)=>page.drawText(h,{x:xs[i],y,font:bold,size:8}));y-=14;
    const drawRow=(r)=>{const vals=[new Date(r.date+'T12:00:00').toLocaleDateString('it-IT'),r.type,r.job,r.private?'Privata':'Aziendale',eur(r.amount),String(r.attachmentCount||0)];vals.forEach((v,i)=>{const max=[50,105,135,70,80,40][i];const text=wrapPdfText(v,font,8,max)[0];page.drawText(text,{x:xs[i],y,font,size:8})});page.drawLine({start:{x:40,y:y-4},end:{x:555,y:y-4},thickness:.4,color:rgb(.85,.88,.92)});y-=17};
    if(!rows.length){page.drawText('Nessuna spesa nel mese.',{x:40,y,font,size:10});y-=20}
    for(const row of rows){if(y<90){({page,y}=addSummaryPage());}drawRow(row)}
    y-=10; if(y<90){({page,y}=addSummaryPage())}
    page.drawText(`Carta privata: ${eur(priv)}`,{x:340,y,font,size:10});y-=16;page.drawText(`Carta aziendale: ${eur(corp)}`,{x:340,y,font,size:10});y-=18;page.drawText(`Totale mese: ${eur(priv+corp)}`,{x:340,y,font:bold,size:12});
    for(const row of rows){
      const files=await getFiles(row.id);
      for(const file of files){
        if(file.type==='application/pdf'){
          try{const source=await PDFDocument.load(await file.blob.arrayBuffer());const copied=await pdf.copyPages(source,source.getPageIndices());copied.forEach((p)=>pdf.addPage(p))}catch(e){const p=pdf.addPage([595.28,841.89]);p.drawText('Giustificativo PDF non incorporabile',{x:40,y:790,font:bold,size:14});p.drawText(file.name,{x:40,y:765,font,size:10})}
        }else if((file.type||'').startsWith('image/')){
          const bytes=await imageBlobToJpegBytes(file.blob), image=await pdf.embedJpg(bytes), p=pdf.addPage([595.28,841.89]);
          p.drawText(`${new Date(row.date+'T12:00:00').toLocaleDateString('it-IT')} - ${row.type}`,{x:36,y:810,font:bold,size:12});
          p.drawText(file.name,{x:36,y:792,font,size:9,color:rgb(.3,.38,.48)});
          const maxW=523,maxH=735,scale=Math.min(maxW/image.width,maxH/image.height,1),w=image.width*scale,h=image.height*scale;
          p.drawImage(image,{x:(595.28-w)/2,y:35+(735-h)/2,width:w,height:h});
        }
      }
    }
    const bytes=await pdf.save(),blob=new Blob([bytes],{type:'application/pdf'}),url=URL.createObjectURL(blob),a=document.createElement('a');
    a.href=url;a.download=`spese-trasferta-${view.getFullYear()}-${String(view.getMonth()+1).padStart(2,'0')}-con-giustificativi.pdf`;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
  }catch(error){console.error(error);alert('Creazione del PDF non riuscita. Verifica la connessione e riprova.');}
  finally{button.disabled=false;button.textContent=old}
}
$('#pdfWithReceipts').onclick=createPdfWithReceipts;

$('#printMonthly').onclick=()=>{
  const content = $('#monthlyBody').innerHTML;
  const w = window.open('', '_blank');
  if(!w){ alert('Consenti i popup per creare il PDF.'); return; }
  w.document.write(`<!doctype html><html lang="it"><head><meta charset="utf-8"><title>Riepilogo spese</title><style>body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#142033;padding:24px}h1{margin-bottom:0}h3{margin-top:6px;color:#526174}table{width:100%;border-collapse:collapse;margin-top:24px;font-size:12px}th,td{border-bottom:1px solid #d8dee8;padding:8px;text-align:left}.money{text-align:right;white-space:nowrap}.summary-totals{margin:24px 0 0 auto;max-width:320px}.summary-totals p{display:flex;justify-content:space-between}.summary-grand{border-top:2px solid #173b66;padding-top:10px;font-size:16px}@media print{body{padding:0}}</style></head><body>${content}</body></html>`);
  w.document.close(); w.focus(); setTimeout(()=>w.print(),250);
};

$('#closePreview').onclick = closePreview;
$('#preview').onclick = (event) => { if (event.target === $('#preview')) closePreview(); };

$('#signIn').onclick = async () => {
  try {
    $('#loginMsg').textContent = '';
    await signInWithEmailAndPassword(auth, $('#email').value.trim(), $('#password').value);
  } catch (error) {
    $('#loginMsg').textContent = 'Accesso non riuscito. Controlla email e password.';
  }
};
$('#logout').onclick = () => signOut(auth);

onAuthStateChanged(auth, (currentUser) => {
  user = currentUser;
  $('#login').classList.toggle('hidden', !!currentUser);
  $('#main').classList.toggle('hidden', !currentUser);
  if (unsub) unsub();
  if (currentUser) {
    unsub = onSnapshot(collection(db, 'users', currentUser.uid, 'days'), (snapshot) => {
      days = {};
      snapshot.forEach((item) => { days[item.id] = item.data(); });
      $('#sync').textContent = 'Dati sincronizzati';
      render();
      show();
    }, () => { $('#sync').textContent = 'Errore di sincronizzazione'; });
  } else {
    days = {};
  }
});

function render() {
  const year = view.getFullYear();
  const month = view.getMonth();
  $('#monthTitle').textContent = new Intl.DateTimeFormat('it-IT', { month: 'long', year: 'numeric' }).format(view);
  const calendar = $('#calendar');
  calendar.innerHTML = '';
  for (let i = 0; i < (new Date(year, month, 1).getDay() + 6) % 7; i++) calendar.append(document.createElement('div'));
  for (let n = 1; n <= new Date(year, month + 1, 0).getDate(); n++) {
    const date = new Date(year, month, n);
    const record = days[key(date)];
    const sum = (record?.items || []).reduce((total, item) => total + item.amount, 0);
    const button = document.createElement('button');
    button.className = `day${key(date) === key(selected) ? ' selected' : ''}`;
    button.innerHTML = `<b>${n}</b>${sum ? `<span class="amt">${eur(sum)}</span>` : ''}`;
    button.onclick = () => { selected = date; show(); render(); };
    calendar.append(button);
  }
}

function current() {
  return days[key(selected)] || { job: '', notes: '', items: [] };
}

function show() {
  const record = current();
  $('#dayTitle').textContent = new Intl.DateTimeFormat('it-IT', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(selected);
  $('#job').value = record.job || '';
  $('#notes').value = record.notes || '';
  $('#expenses').innerHTML = (record.items || []).map((item) => {
    const attachment = item.attachmentCount
      ? ` · <button type="button" class="attachment" data-id="${esc(item.id)}">📎 ${item.attachmentCount} ${item.attachmentCount === 1 ? 'giustificativo' : 'giustificativi'}</button>`
      : '';
    return `<div class="expense"><div><strong>${esc(item.type)}</strong><small>${item.private ? 'Carta privata' : 'Carta aziendale'}${attachment}</small></div><div><strong>${eur(item.amount)}</strong> <button class="delete" data-id="${esc(item.id)}">×</button></div></div>`;
  }).join('');
  document.querySelectorAll('.delete').forEach((button) => { button.onclick = () => removeExpense(button.dataset.id); });
  document.querySelectorAll('.attachment').forEach((button) => { button.onclick = () => showAttachments(button.dataset.id); });
  const privateTotal = (record.items || []).filter((item) => item.private).reduce((total, item) => total + item.amount, 0);
  const corporateTotal = (record.items || []).filter((item) => !item.private).reduce((total, item) => total + item.amount, 0);
  $('#privTotal').textContent = eur(privateTotal);
  $('#corpTotal').textContent = eur(corporateTotal);
  $('#total').textContent = eur(privateTotal + corporateTotal);
}

async function saveDay(next) {
  $('#sync').textContent = 'Salvataggio…';
  await setDoc(doc(db, 'users', user.uid, 'days', key(selected)), { ...next, date: key(selected), updatedAt: serverTimestamp() });
}

async function removeExpense(expenseId) {
  const record = current();
  await saveDay({ ...record, items: record.items.filter((item) => item.id !== expenseId) });
  await deleteFiles(expenseId).catch(() => {});
}

$('#job').onchange = () => saveDay({ ...current(), job: $('#job').value });
$('#notes').onchange = () => saveDay({ ...current(), notes: $('#notes').value });
$('#add').onclick = () => $('#form').classList.toggle('hidden');

function collect(input) {
  for (const file of [...input.files]) {
    if (!pending.some((item) => item.name === file.name && item.size === file.size && item.lastModified === file.lastModified)) pending.push(file);
  }
  $('#receiptList').textContent = pending.length ? pending.map((file) => file.name).join(' · ') : 'Nessun allegato';
  input.value = '';
}

$('#btnCamera').onclick = () => $('#camera').click();
$('#btnPhoto').onclick = () => $('#photo').click();
$('#btnFile').onclick = () => $('#file').click();
['camera', 'photo', 'file'].forEach((name) => { $(`#${name}`).onchange = (event) => collect(event.target); });

$('#save').onclick = async () => {
  const amount = Number($('#amount').value);
  if (!amount || amount <= 0) {
    $('#formMsg').textContent = 'Inserisci un importo valido.';
    return;
  }
  const expenseId = newId();
  const filesToSave = [...pending];
  const item = {
    id: expenseId,
    type: $('#type').value,
    amount: Math.round(amount * 100) / 100,
    private: $('#private').checked,
    attachmentCount: filesToSave.length,
    attachmentDevice: navigator.userAgent.includes('iPhone') ? 'iPhone' : 'PC/browser'
  };
  try {
    await storeFiles(expenseId, filesToSave);
    await saveDay({ ...current(), items: [...(current().items || []), item] });
    pending = [];
    $('#receiptList').textContent = 'Nessun allegato';
    $('#amount').value = '';
    $('#private').checked = false;
    $('#formMsg').textContent = '';
    $('#form').classList.add('hidden');
  } catch (error) {
    await deleteFiles(expenseId).catch(() => {});
    $('#formMsg').textContent = 'Salvataggio non riuscito.';
  }
};

$('#prev').onclick = () => { view = new Date(view.getFullYear(), view.getMonth() - 1, 1); render(); };
$('#next').onclick = () => { view = new Date(view.getFullYear(), view.getMonth() + 1, 1); render(); };
$('#today').onclick = () => { view = new Date(); selected = new Date(); render(); show(); };

if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js?v=9');
render();
show();
