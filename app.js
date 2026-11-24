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

if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js?v=7');
render();
show();
