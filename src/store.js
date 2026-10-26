import {createClient} from '@supabase/supabase-js';
import {useEffect,useState} from 'react';
export const supabase=createClient(import.meta.env.VITE_SUPABASE_URL,import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY);
let state={user:null,records:{},pending:{},versions:{},status:'loading',error:'',conflicts:{}};
const listeners=new Set();let syncing=false;let epoch=0;
const emit=()=>{state={...state};listeners.forEach(fn=>fn(state));};
const cacheKey=()=>`khuttati:v1:${state.user.id}`;
function persist(){if(!state.user)return;try{localStorage.setItem(cacheKey(),JSON.stringify({records:state.records,pending:state.pending,versions:state.versions}));}catch{state.error='تعذر حفظ نسخة الانتظار على الجهاز. أبقِ الصفحة مفتوحة حتى تكتمل المزامنة.';}}
export async function loadUser(user){epoch++;state={user,records:{},pending:{},versions:{},conflicts:{},status:user?'syncing':'guest',error:''};if(user){try{const saved=JSON.parse(localStorage.getItem(cacheKey())||'{}');state.records=saved.records||{};state.pending=saved.pending||{};state.versions=saved.versions||{};}catch{state.error='تعذر قراءة النسخة المحلية.';}}emit();if(user)await sync();}
export async function saveRecord(key,value){if(!state.user)throw new Error('سجّل دخولك أولًا لحفظ بياناتك في Supabase.');state.records={...state.records,[key]:value};state.pending={...state.pending,[key]:{value,revision:crypto.randomUUID()}};state.status='pending';persist();emit();void sync();}
export async function sync(){
 if(syncing||!state.user)return;syncing=true;const mine=epoch,userId=state.user.id;state.status='syncing';emit();
 try{
  if(!navigator.onLine)throw new Error('أنت دون اتصال. التسجيلات محفوظة مؤقتًا على الجهاز وتنتظر المزامنة.');
  for(const [key,entry] of Object.entries(state.pending)){
   if(state.conflicts[key])continue;
   const {data,error}=await supabase.rpc('save_fitness_record',{record_key:key,record_value:entry.value,expected_version:state.versions[key]||0});
   if(mine!==epoch)return;
   if(error){if(error.message.includes('VERSION_CONFLICT')){const remote=await supabase.from('fitness_records').select('*').eq('key',key).single();if(remote.error)throw remote.error;state.conflicts={...state.conflicts,[key]:remote.data};continue;}throw error;}
   state.versions={...state.versions,[key]:data.version};
   if(state.pending[key]?.revision===entry.revision){const pending={...state.pending};delete pending[key];state.pending=pending;}
   persist();
  }
  const remote={};let offset=0;
  while(true){const {data,error}=await supabase.from('fitness_records').select('*').eq('user_id',userId).order('key').range(offset,offset+499);if(error)throw error;if(mine!==epoch)return;data.forEach(row=>remote[row.key]=row);if(data.length<500)break;offset+=500;}
  for(const row of Object.values(remote))if(!state.pending[row.key]){state.records={...state.records,[row.key]:row.value};state.versions={...state.versions,[row.key]:row.version};}
  state.error='';state.status=Object.keys(state.conflicts).length?'conflict':Object.keys(state.pending).length?'pending':'saved';persist();
 }catch(e){if(mine===epoch){state.status='error';state.error=e.message||'تعذر الاتصال. لم تُحفظ التغييرات بالسحابة بعد.';}}
 finally{syncing=false;emit();if(mine!==epoch&&state.user)void sync();else if(state.status==='pending')queueMicrotask(sync);}
}
export function resolveConflict(key,useLocal){const remote=state.conflicts[key];if(!remote)return;state.versions={...state.versions,[key]:remote.version};if(!useLocal){state.records={...state.records,[key]:remote.value};const p={...state.pending};delete p[key];state.pending=p;}const c={...state.conflicts};delete c[key];state.conflicts=c;persist();emit();void sync();}
export function useStore(){const [s,set]=useState(state);useEffect(()=>{listeners.add(set);return()=>listeners.delete(set)},[]);return s;}
let initialized=false;
export function initStore(){if(initialized)return;initialized=true;supabase.auth.getSession().then(({data,error})=>{if(error){state.error=error.message;emit();}void loadUser(data.session?.user||null)});supabase.auth.onAuthStateChange((event,session)=>{if(event==='PASSWORD_RECOVERY')window.dispatchEvent(new Event('password-recovery'));if(session?.user.id!==state.user?.id)queueMicrotask(()=>loadUser(session?.user||null));});window.addEventListener('online',sync);window.addEventListener('focus',sync);document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')void sync()});setInterval(()=>{if(document.visibilityState==='visible'&&state.user)void sync()},60000);}
export async function uploadPrivate(file,kind,date){if(!state.user)throw new Error('سجّل دخولك لرفع ملفاتك الخاصة.');if(file.size>20*1024*1024)throw new Error('الحد الأقصى للملف 20 ميغابايت.');if(!['image/jpeg','image/png','image/webp','video/mp4','video/webm'].includes(file.type))throw new Error('اختر صورة JPG/PNG/WebP أو فيديو MP4/WebM.');const id=crypto.randomUUID();const ext=file.type.split('/')[1];const path=`${state.user.id}/${id}.${ext}`;const {error}=await supabase.storage.from('fitness-private').upload(path,file,{contentType:file.type});if(error)throw error;await saveRecord(`media:${id}`,{path,kind,date,type:file.type,name:file.name});return path;}
export async function mediaUrl(path){const {data,error}=await supabase.storage.from('fitness-private').createSignedUrl(path,600);if(error)throw error;return data.signedUrl;}
export async function deleteMedia(key,entry){const {error}=await supabase.storage.from('fitness-private').remove([entry.path]);if(error)throw error;await saveRecord(key,{...entry,deleted:true});}
