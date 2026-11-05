// The map and local records stay usable even when the optional account service is offline.
const platform='https://softm.github.io/shared/platform/v1/';
export function setupMyPage({favoritesCount,showFavorites,destinations,removeDestination}){
  const byId=id=>document.getElementById(id),page=byId('my-page');
  let account,vault,connecting,busy=false,status='',ready=false;
  const renderAccount=()=>{
    const user=account?.currentUser;
    byId('my-identity').textContent=status||(user?(user.displayName||'로그인한 계정'):'로그인하지 않아도 이 기기의 자료를 관리할 수 있습니다.');
    byId('my-login').hidden=Boolean(user);byId('my-login').disabled=!ready||busy;
    byId('my-signup').hidden=Boolean(user)||!ready;byId('my-signup').disabled=busy;
    byId('my-logout').hidden=!user;byId('my-logout').disabled=busy;
    byId('my-cloud').hidden=!user;byId('my-account-manage').hidden=!user;
    byId('my-retry').hidden=ready||!status||Boolean(connecting);
  };
  async function connect(){
    if(ready||connecting)return;
    status='계정 확인 중…';
    connecting=(async()=>{
      if(!account){
        const {createAccountContext}=await import(platform+'site-account.mjs?v=20261030-menu-1');
        account=createAccountContext({siteId:'juyuhannun'});account.subscribe(renderAccount);
        window.SoftmAccounts ||= new Map();window.SoftmAccounts.set('juyuhannun',account);
        window.dispatchEvent(new CustomEvent('softm:account-ready',{detail:{siteId:'juyuhannun',account}}));
      }
      await account.ready();ready=true;status='';
    })().catch(()=>{status='계정에 연결하지 못했습니다. 이 기기의 자료는 계속 이용할 수 있습니다.';}).finally(()=>{connecting=null;renderAccount();});
    renderAccount();await connecting;
  }
  function renderRecords(){
    byId('my-favorites').textContent='찜한 주유소 '+favoritesCount()+'곳 보기';
    const list=byId('my-destinations');list.replaceChildren();
    for(const item of destinations()){
      const row=document.createElement('li'),label=document.createElement('span'),button=document.createElement('button');
      label.textContent=item.label;button.type='button';button.textContent='삭제';button.setAttribute('aria-label',item.label+' 기기 목록에서 삭제');
      button.onclick=()=>{removeDestination(item.id);renderRecords();};row.append(label,button);list.append(row);
    }
    if(!list.children.length){const row=document.createElement('li');row.textContent='저장한 목적지가 없습니다.';list.append(row);}
  }
  for(const trigger of document.querySelectorAll('[data-my-page]'))trigger.addEventListener('click',()=>{
    if(byId('more-dialog').open)byId('more-dialog').close();
    renderRecords();renderAccount();page.showModal();void connect();
  });
  byId('my-favorites').onclick=()=>{page.close();showFavorites();};
  byId('my-retry').onclick=connect;
  async function authenticate(mode){
    if(!ready||busy)return;
    const popup=window.open('about:blank','_blank','popup,width=520,height=760');
    if(!popup){status='로그인 창을 열 수 없습니다. 팝업을 허용해 주세요.';renderAccount();return;}
    busy=true;status='로그인 화면을 열고 있습니다.';renderAccount();
    try{await account.login({popup,mode});status='';}catch(error){try{popup.close();}catch{}status=error?.message||'로그인을 완료하지 못했습니다.';}
    finally{busy=false;renderAccount();}
  }
  byId('my-login').onclick=()=>authenticate('login');byId('my-signup').onclick=()=>authenticate('signup');
  byId('my-logout').onclick=async()=>{if(busy)return;busy=true;renderAccount();try{await account.logout();status='';}catch{status='로그아웃하지 못했습니다.';}finally{busy=false;renderAccount();}};
  byId('my-backups').onclick=async()=>{
    if(!account?.currentUser)return;
    const button=byId('my-backups');button.disabled=true;
    try{
      if(!vault){
        const [{mountSiteVault},{SITE_INTEGRATIONS}]=await Promise.all([import(platform+'site-vault.mjs?v=20261029-account-1'),import(platform+'site-integrations.mjs')]);
        vault=mountSiteVault({siteId:'juyuhannun',...SITE_INTEGRATIONS.juyuhannun,target:'body',account,hideLauncher:true});
      }
      if(!account.currentUser)return;
      vault.open();page.close();
    }catch{status='백업 관리 화면을 열지 못했습니다. 다시 시도해 주세요.';renderAccount();}
    finally{button.disabled=false;}
  };
}
