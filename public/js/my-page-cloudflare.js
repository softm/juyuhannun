// Cloudflare common account (Google / Kakao / Naver). All local map records remain on this device.
import {ACCOUNT_ORIGIN,createCloudflareAccount,getAvailableProviders} from './cloudflare-account.js';

export function setupMyPage({favoritesCount,showFavorites,destinations,removeDestination}){
  const byId=id=>document.getElementById(id);
  const page=byId('my-page');
  const account=createCloudflareAccount();
  const entry=document.querySelector('.app-header [data-my-page]');
  const accountSection=byId('my-identity').closest('section');
  const selector=document.createElement('div');
  selector.id='my-providers';
  selector.className='cf-provider-options';
  selector.hidden=true;
  selector.setAttribute('aria-label','SNS 로그인 선택');
  accountSection.append(selector);
  const notice=document.createElement('p');
  notice.className='cf-account-note';
  notice.textContent='주유소 검색은 로그인 없이 이용할 수 있습니다. 찜·최근 목적지는 현재 기기에만 보관되며, 로그인만으로 서버에 전송되지 않습니다.';
  accountSection.append(notice);
  byId('my-account-manage').href=ACCOUNT_ORIGIN+'/account';
  byId('my-cloud').hidden=true; // Account-only rollout; app-specific D1 sync is not enabled.
  let providers=null,checking=null,busy=false,error='',mode='login';

  function accountAvatar(){
    if(!entry)return;
    const user=account.currentUser;
    entry.classList.add('cf-account-trigger');
    entry.replaceChildren();
    if(!user){
      const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
      svg.setAttribute('viewBox','0 0 24 24');
      svg.setAttribute('aria-hidden','true');
      const circle=document.createElementNS('http://www.w3.org/2000/svg','circle');
      circle.setAttribute('cx','12');circle.setAttribute('cy','8');circle.setAttribute('r','4');
      const path=document.createElementNS('http://www.w3.org/2000/svg','path');
      path.setAttribute('d','M4 21v-2a8 8 0 0 1 16 0v2');
      svg.append(circle,path);entry.append(svg);
      entry.title='로그인';entry.setAttribute('aria-label','로그인 및 회원가입');
    }else{
      const name=String(user.displayName||'한눈').trim()||'한눈';
      const avatar=document.createElement('span');
      avatar.className='cf-account-avatar';
      avatar.textContent=name.slice(0,1);
      const photo=user.photoURL;
      if(typeof photo==='string'){
        try{
          const url=new URL(photo);
          if(url.protocol==='https:' && !url.username && !url.password && photo.length<=2048){
            const img=document.createElement('img');
            img.src=url.href;img.alt='';img.loading='lazy';img.referrerPolicy='no-referrer';
            img.addEventListener('error',()=>{avatar.textContent=name.slice(0,1);},{once:true});
            avatar.replaceChildren(img);
          }
        }catch{}
      }
      entry.append(avatar);
      entry.title=name+' · 내 계정';entry.setAttribute('aria-label',name+' 계정 관리');
    }
    entry.setAttribute('aria-busy',busy?'true':'false');
    entry.disabled=busy;
  }
  function render(){
    const user=account.currentUser;
    byId('my-identity').textContent=error || (user?
      (user.displayName||'한눈 계정')+' 계정으로 로그인되었습니다.':
      'Google·카카오·네이버로 로그인하거나 가입할 수 있습니다.');
    byId('my-login').hidden=!!user;
    byId('my-signup').hidden=!!user;
    byId('my-logout').hidden=!user;
    byId('my-login').disabled=busy;
    byId('my-signup').disabled=busy || providers?.registrationLocked===true;
    byId('my-logout').disabled=busy;
    byId('my-retry').hidden=!error || busy;
    byId('my-account-manage').hidden=!user;
    byId('my-cloud').hidden=true;
    if(user)selector.hidden=true;
    const mobileEntry=document.querySelector('.more-menu [data-my-page]');
    if(mobileEntry){
      const label=mobileEntry.querySelector('strong'),summary=mobileEntry.querySelector('small');
      if(label)label.textContent=user?'마이페이지':'로그인·회원가입';
      if(summary)summary.textContent=user?'로그인 상태·기기 자료 확인':'한눈 공통 계정으로 계속하기';
    }
    accountAvatar();
  }
  function providerButton(provider,label,mark){
    const enabled=providers?.[provider]===true;
    const button=document.createElement('button');
    button.type='button';
    button.className='cf-provider cf-provider-'+provider;
    button.disabled=!enabled || busy;
    const glyph=document.createElement('strong');
    glyph.className='cf-provider-mark';
    glyph.textContent=mark;
    glyph.setAttribute('aria-hidden','true');
    const caption=document.createElement('span');
    caption.textContent=enabled?label+'로 계속하기':
      label+(provider==='naver'?' · 승인 대기':' · 연결 준비 중');
    button.append(glyph,caption);
    button.addEventListener('click',()=>{void authenticate(provider);});
    return button;
  }
  function renderProviders(){
    selector.replaceChildren();
    if(selector.hidden)return;
    const heading=document.createElement('p');
    heading.textContent=mode==='signup'?'SNS 인증 후 약관 동의와 회원가입이 이어집니다.':'로그인할 SNS를 선택하세요. 처음이라면 회원가입이 이어집니다.';
    selector.append(heading);
    for(const [id,name,mark] of [['google','Google','G'],['kakao','카카오','●'],['naver','네이버','N']])
      selector.append(providerButton(id,name,mark));
    if(checking){
      const state=document.createElement('small');
      state.textContent='Cloudflare 로그인 상태 확인 중…';
      selector.append(state);
    }else if(!providers){
      const state=document.createElement('small');
      state.textContent='로그인 서버에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.';
      selector.append(state);
    }
  }
  async function verifyProviders(){
    if(checking)return checking;
    checking=getAvailableProviders().then(value=>{providers=value;error='';return value;})
      .catch(()=>{providers=null;error='로그인 서버 상태를 확인하지 못했습니다. 지도와 기기 자료는 계속 이용할 수 있습니다.';})
      .finally(()=>{checking=null;render();renderProviders();});
    renderProviders();
    return checking;
  }
  function showProviders(nextMode){
    if(nextMode==='signup' && providers?.registrationLocked===true){error='현재 신규 회원가입을 받을 수 없습니다.';render();return;}
    mode=nextMode;
    selector.hidden=false;
    renderProviders();
    if(!providers)void verifyProviders();
  }
  async function authenticate(provider){
    if(busy||providers?.[provider]!==true)return;
    busy=true;error='';render();renderProviders();
    try{
      // login opens the browser window synchronously from the original click.
      const user=await account.login(provider);
      if(user){selector.hidden=true;error='';}
    }catch(e){
      error=e?.message||'로그인을 완료하지 못했습니다.';
    }finally{
      busy=false;render();renderProviders();
    }
  }
  function renderRecords(){
    byId('my-favorites').textContent='찜한 주유소 '+favoritesCount()+'곳 보기';
    const list=byId('my-destinations');list.replaceChildren();
    for(const item of destinations()){
      const row=document.createElement('li'),label=document.createElement('span'),button=document.createElement('button');
      label.textContent=item.label;button.type='button';button.textContent='삭제';
      button.setAttribute('aria-label',item.label+' 기기 목록에서 삭제');
      button.onclick=()=>{removeDestination(item.id);renderRecords();};
      row.append(label,button);list.append(row);
    }
    if(!list.children.length){
      const row=document.createElement('li');row.textContent='저장한 목적지가 없습니다.';list.append(row);
    }
  }
  for(const trigger of document.querySelectorAll('[data-my-page]')){
    trigger.addEventListener('click',()=>{
      if(byId('more-dialog')?.open)byId('more-dialog').close();
      renderRecords();render();page.showModal();
      if(!account.currentUser)showProviders('login');
      void verifyProviders();
    });
  }
  byId('my-favorites').onclick=()=>{page.close();showFavorites();};
  byId('my-login').onclick=()=>showProviders('login');
  byId('my-signup').onclick=()=>showProviders('signup');
  byId('my-retry').onclick=()=>{error='';void verifyProviders();};
  byId('my-logout').onclick=async()=>{
    if(busy)return;
    busy=true;error='';render();
    try{await account.logout();selector.hidden=true;}
    catch(e){error=e?.message||'로그아웃 처리에 실패했습니다.';}
    finally{busy=false;render();}
  };
  // The account's site-scoped session must never enable the retired Firebase vault.
  byId('my-backups').disabled=true;
  render();
  void verifyProviders();
}
