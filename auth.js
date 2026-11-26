import { config } from './config.js';

const storageKey = 'france-si-session';
const readSession = () => { try { return JSON.parse(localStorage.getItem(storageKey) || 'null'); } catch { return null; } };
const storeSession = session => localStorage.setItem(storageKey, JSON.stringify(session));
let activeRefresh;
export let accessScope='full';
export let canDeleteRecords=false;

async function authCall(path, body) {
  const response = await fetch(config.url + '/auth/v1/' + path, {
    method: 'POST', headers: { apikey: config.key, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.msg || data.error_description || data.message || '登录暂时失败，请稍后重试。');
  return data;
}

async function session() {
  const refresh = async () => {
    const current = readSession();
    if (!current?.refresh_token) return null;
    if (current.expires_at > Date.now() / 1000 + 60) return current;
    const fresh = await authCall('token?grant_type=refresh_token', { refresh_token: current.refresh_token });
    fresh.expires_at = Date.now() / 1000 + fresh.expires_in;
    storeSession(fresh);
    return fresh;
  };
  // Share token refreshes across requests and browser tabs.
  activeRefresh ||= (navigator.locks ? navigator.locks.request(storageKey, refresh) : refresh()).finally(() => { activeRefresh = null; });
  return activeRefresh;
}

export async function authorizedFetch(path, args = {}) {
  let current;
  try { current = await session(); } catch { throw new Error('登录连接暂时失败，请重试。'); }
  if (!current?.access_token) { showLogin(); throw new Error('请先登录看板。'); }
  const headers = new Headers(args.headers);
  headers.set('Authorization', 'Bearer ' + current.access_token);
  headers.set('apikey', config.key);
  const response = await fetch(config.url + '/functions/v1/board' + path, { ...args, headers });
  if (response.status === 401) {
    localStorage.removeItem(storageKey);
    showLogin();
  }
  return response;
}

function showLogin() { document.getElementById('login-screen').hidden = false; document.getElementById('dashboard').hidden = true; }
function showDashboard() { document.getElementById('login-screen').hidden = true; document.getElementById('dashboard').hidden = false; }

export async function ready() {
  const form = document.getElementById('login-form');
  const error = document.getElementById('login-error');
  const email = document.getElementById('login-email');
  const fragment = new URLSearchParams(location.hash.slice(1));
  if (fragment.has('access_token') && fragment.has('refresh_token')) {
    storeSession({ access_token: fragment.get('access_token'), refresh_token: fragment.get('refresh_token'), expires_at: Date.now() / 1000 + Number(fragment.get('expires_in') || 3600) });
    history.replaceState(null, '', location.pathname + location.search);
  }
  if (fragment.has('error_description')) {
    error.textContent = fragment.get('error_description');
    history.replaceState(null, '', location.pathname + location.search);
  }
  document.getElementById('password-form').addEventListener('submit',async event=>{
    event.preventDefault();const button=document.getElementById('password-login');const message=document.getElementById('password-error');button.disabled=true;message.textContent='';
    try{
      const username=document.getElementById('login-username').value.trim().toLowerCase();
      if(username!=='yealink')throw Error('账号或密码错误。');
      const fresh=await authCall('token?grant_type=password',{email:'yealink@users.yanghai-si.invalid',password:document.getElementById('login-password').value});
      fresh.expires_at=Date.now()/1000+fresh.expires_in;storeSession(fresh);location.hash='upsell-board';location.reload();
    }catch(e){message.textContent='账号或密码错误，或登录暂时不可用，请重试。';}finally{button.disabled=false;}
  });
  form.addEventListener('submit', async event => {
    event.preventDefault();
    error.textContent = '';
    if (!email.reportValidity()) return;
    const button = document.getElementById('send-link');
    button.disabled = true;
    try {
      await authCall('otp?redirect_to=' + encodeURIComponent(config.siteUrl), { email: email.value.trim(), create_user: true });
      document.getElementById('login-hint').textContent = '登录链接已发送，请查看邮箱和垃圾邮件，并在这台电脑上打开邮件中的链接。';
    } catch (e) { error.textContent = e.message; }
    finally { setTimeout(() => { button.disabled = false; }, 60000); }
  });
  document.getElementById('logout').addEventListener('click', async () => {
    const current = readSession();
    localStorage.removeItem(storageKey);
    if (current?.access_token) await fetch(config.url + '/auth/v1/logout?scope=local', {
      method: 'POST', headers: { apikey: config.key, Authorization: 'Bearer ' + current.access_token },
    }).catch(() => {});
    location.reload();
  });
  addEventListener('storage', event => { if (event.key === storageKey && !event.newValue) location.reload(); });
  try {
    if (await session()) {
      const response=await authorizedFetch('/api/session');if(!response.ok)throw Error('该账号没有看板访问权限。');
      const sessionInfo=await response.json();accessScope=sessionInfo.scope;canDeleteRecords=sessionInfo.canDelete===true;
      if(accessScope==='upsell'){
        for(const id of ['tab-si','tab-projects','tab-consultations','tab-kpi'])document.getElementById(id).hidden=true;
        document.getElementById('title').textContent='Upsell 跟进看板';
        document.querySelector('.intro p').textContent='耳机、VC 设备与服务 Upsell 跟进。';
        document.querySelector('.private').textContent='Upsell 专用账号';
        location.hash='upsell-board';
      }
      showDashboard(); return;
    }
  } catch { /* A cached session can be recovered by signing in again. */ }
  showLogin();
  await new Promise(() => {});
}
