// Cloudflare authentication only. Device bookmarks and destinations are managed separately.
// The common Worker decides whether the verified SNS user must complete member signup.
import {ACCOUNT_ORIGIN,createCloudflareAccount,getAvailableProviders} from './cloudflare-account.js';

export function setupMyPage({favoritesCount,showFavorites,destinations,removeDestination}){
  const byId=id=>document.getElementById(id);
  const dialog=byId('my-page');
  const deviceDialog=byId('device-page');
  const account=createCloudflareAccount();
  const guest=byId('account-guest');
  const signed=byId('account-user');
  const providersBox=byId('my-providers');
  const status=byId('my-identity');
  const retry=byId('my-retry');
  const logoutButton=byId('my-logout');
  const headerEntry=document.querySelector('.app-header [data-my-page]');
  const mobileEntry=document.querySelector('.more-menu [data-my-page]');
  const icons=['google','kakao','naver'];
  const names={google:'Google',kakao:'카카오',naver:'네이버'};
  let providers=null;
  let checking=null;
  let busy=false;
  let error='';

  const svgNS='http://www.w3.org/2000/svg';
  function appendPersonIcon(target){
    const svg=document.createElementNS(svgNS,'svg');
    svg.setAttribute('viewBox','0 0 24 24');
    svg.setAttribute('aria-hidden','true');
    const head=document.createElementNS(svgNS,'circle');
    head.setAttribute('cx','12');head.setAttribute('cy','8');head.setAttribute('r','4');
    const torso=document.createElementNS(svgNS,'path');
    torso.setAttribute('d','M4 21v-2a8 8 0 0 1 16 0v2');
    svg.append(head,torso);
    target.append(svg);
  }
  function avatarElement(user,className){
    const name=String(user?.displayName||'한눈').trim()||'한눈';
    const avatar=document.createElement('span');
    avatar.className=className;
    avatar.textContent=name.slice(0,1);
    if(typeof user?.photoURL==='string'&&user.photoURL.length<=2048){
      try{
        const url=new URL(user.photoURL);
        if(url.protocol==='https:'&&!url.username&&!url.password){
          const photo=document.createElement('img');
          photo.src=url.href;photo.alt='';photo.loading='lazy';photo.referrerPolicy='no-referrer';
          photo.addEventListener('error',()=>{avatar.textContent=name.slice(0,1);},{once:true});
          avatar.replaceChildren(photo);
        }
      }catch{}
    }
    return avatar;
  }
  function renderEntry(){
    const user=account.currentUser;
    if(headerEntry){
      headerEntry.classList.add('cf-account-trigger');
      headerEntry.replaceChildren();
      if(user)headerEntry.append(avatarElement(user,'cf-account-avatar'));
      else appendPersonIcon(headerEntry);
      headerEntry.disabled=busy;
      headerEntry.setAttribute('aria-busy',String(busy));
      headerEntry.title=user?(user.displayName||'한눈 계정')+' · 계정 관리':'로그인';
      headerEntry.setAttribute('aria-label',user?'내 계정':'로그인');
    }
    if(mobileEntry){
      const label=mobileEntry.querySelector('strong');
      const summary=mobileEntry.querySelector('small');
      if(label)label.textContent=user?'내 계정':'로그인';
      if(summary)summary.textContent=user?'한눈 공통 계정 관리':'Google · 카카오 · 네이버';
    }
  }
  function renderProviders(){
    if(guest.hidden)return;
    providersBox.replaceChildren();
    for(const id of icons){
      const enabled=providers?.[id]===true;
      const button=document.createElement('button');
      button.type='button';
      button.className='cf-provider cf-provider-'+id;
      button.disabled=!enabled||busy;
      button.dataset.provider=id;
      const symbol=document.createElement('span');
      symbol.className='cf-provider-mark';
      symbol.textContent=id==='google'?'G':id==='kakao'?'●':'N';
      symbol.setAttribute('aria-hidden','true');
      const caption=document.createElement('span');
      caption.textContent=names[id]+'로 계속하기';
      button.append(symbol,caption);
      if(!enabled){
        const explanation=document.createElement('small');
        explanation.className='cf-provider-unavailable';
        explanation.textContent=providers===null?'확인 중':id==='naver'?'승인 대기':'준비 중';
        button.append(explanation);
      }
      button.addEventListener('click',()=>{void authenticate(id);});
      providersBox.append(button);
    }
  }
  function render(){
    const user=account.currentUser;
    guest.hidden=Boolean(user);
    signed.hidden=!user;
    if(user){
      byId('my-avatar').replaceChildren(avatarElement(user,'cf-account-avatar-large'));
      byId('my-name').textContent=user.displayName||'한눈 계정';
    }
    status.hidden=!error;
    status.textContent=error;
    retry.hidden=!error||Boolean(user)||busy;
    logoutButton.disabled=busy;
    renderEntry();
    renderProviders();
  }
  async function refreshProviders(){
    if(checking)return checking;
    checking=getAvailableProviders()
      .then(value=>{providers=value;error='';})
      .catch(()=>{providers=null;error='공통 계정에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.';})
      .finally(()=>{checking=null;render();});
    renderProviders();
    return checking;
  }
  async function authenticate(provider){
    if(busy||!providers?.[provider])return;
    busy=true;error='';render();
    try{
      // login opens a popup synchronously from the provider button click.
      await account.login(provider);
      if(account.currentUser)dialog.close();
    }catch(e){error=e?.message||'SNS 로그인을 완료하지 못했습니다.';}
    finally{busy=false;render();}
  }
  function openAccount(){
    if(byId('more-dialog')?.open)byId('more-dialog').close();
    error='';
    render();
    if(!dialog.open)dialog.showModal();
    if(!account.currentUser)void refreshProviders();
  }
  function renderDeviceRecords(){
    byId('my-favorites').textContent='찜한 주유소 '+favoritesCount()+'곳 보기';
    const list=byId('my-destinations');
    list.replaceChildren();
    for(const item of destinations()){
      const row=document.createElement('li');
      const label=document.createElement('span');
      const button=document.createElement('button');
      label.textContent=item.label;
      button.type='button';button.textContent='삭제';
      button.setAttribute('aria-label',item.label+' 기기 목록에서 삭제');
      button.onclick=()=>{removeDestination(item.id);renderDeviceRecords();};
      row.append(label,button);list.append(row);
    }
    if(!list.childElementCount){
      const row=document.createElement('li');row.textContent='저장한 목적지가 없습니다.';
      list.append(row);
    }
  }
  for(const element of document.querySelectorAll('[data-my-page]')){
    element.addEventListener('click',openAccount);
  }
  for(const element of document.querySelectorAll('[data-device-records]')){
    element.addEventListener('click',()=>{
      if(byId('more-dialog')?.open)byId('more-dialog').close();
      renderDeviceRecords();
      if(!deviceDialog.open)deviceDialog.showModal();
    });
  }
  byId('my-favorites').addEventListener('click',()=>{
    deviceDialog.close();
    showFavorites();
  });
  retry.addEventListener('click',()=>{error='';void refreshProviders();});
  logoutButton.addEventListener('click',async()=>{
    if(busy)return;
    busy=true;error='';render();
    try{await account.logout();}
    catch(e){error=e?.message||'로그아웃하지 못했습니다.';}
    finally{busy=false;render();}
  });
  byId('my-account-manage').href=ACCOUNT_ORIGIN+'/account';
  render();
  void refreshProviders();
}
