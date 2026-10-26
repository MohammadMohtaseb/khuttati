import React,{useEffect,useState} from 'react';
import {supabase} from './store';

export default function SharePlan({ownerId}){
  const [shares,setShares]=useState([]);
  const [email,setEmail]=useState('');
  const [busy,setBusy]=useState(false);
  const [loading,setLoading]=useState(true);
  const [message,setMessage]=useState('');
  const [error,setError]=useState('');

  async function refresh(){
    const {data,error}=await supabase.from('plan_shares')
      .select('recipient_email,created_at')
      .eq('owner_id',ownerId)
      .order('created_at',{ascending:false});
    if(error)throw error;
    setShares(data||[]);
  }
  useEffect(()=>{
    let active=true;
    supabase.from('plan_shares').select('recipient_email,created_at')
      .eq('owner_id',ownerId).order('created_at',{ascending:false})
      .then(({data,error})=>{
        if(!active)return;
        if(error)setError('تعذر تحميل قائمة المشاركة. حاول تحديث الصفحة.');
        else setShares(data||[]);
        setLoading(false);
      });
    return()=>{active=false};
  },[ownerId]);

  async function add(event){
    event.preventDefault();
    const recipient=email.trim().toLowerCase();
    setBusy(true);setError('');setMessage('');
    try{
      const {error}=await supabase.from('plan_shares').insert({owner_id:ownerId,recipient_email:recipient});
      if(error)throw error;
      await refresh();
      setEmail('');
      setMessage('تم منح الوصول. يستطيع الشخص الدخول بنفس البريد عبر Google وفتح الخطة.');
    }catch(e){setError(e.code==='23505'?'هذا البريد لديه وصول بالفعل.':'تعذر منح الوصول. تأكد من البريد وحاول مرة ثانية.');}
    finally{setBusy(false);}
  }

  async function remove(recipient){
    setBusy(true);setError('');setMessage('');
    try{
      const {error}=await supabase.from('plan_shares').delete()
        .eq('owner_id',ownerId).eq('recipient_email',recipient);
      if(error)throw error;
      await refresh();
      setMessage('توقّف وصول هذا الحساب عند الطلب التالي للخطة.');
    }catch{setError('تعذر إيقاف الوصول. حاول مرة ثانية.');}
    finally{setBusy(false);}
  }

  return <section className="card plan-sharing" aria-labelledby="sharing-title">
    <h2 id="sharing-title">مشاركة خطتي الخاصة</h2>
    <p>أدخل بريد الشخص الذي تريد منحه نسخة من خطة التمرين والتغذية وملفّي PDF. يستطيع استخدام الخطة داخل حسابه، وتبقى تسجيلاته وصوره منفصلة عن بياناتك.</p>
    <form className="share-form" onSubmit={add}>
      <label className="field"><span>بريد الشخص</span><input type="email" required maxLength={254} autoComplete="off" dir="ltr" value={email} onChange={e=>setEmail(e.target.value)} placeholder="name@example.com"/></label>
      <button className="button" disabled={busy}>{busy?'جارٍ الحفظ…':'امنح الوصول'}</button>
    </form>
    {message&&<p className="notice" role="status">{message}</p>}
    {error&&<p className="notice warning" role="alert">{error}</p>}
    <p className="muted">أرسل له <a href="https://khuttati.pages.dev/">رابط خُطّتي</a>. عليه الدخول باستخدام Google بالبريد نفسه، ثم تحديث الصفحة إذا كان مسجّلًا مسبقًا. يستطيع تنزيل ملفات الخطة، وإيقاف الوصول لاحقًا لا يحذف النسخ التي سبق أن نزّلها.</p>
    <h3>الأشخاص المسموح لهم</h3>
    {loading?<p>جارٍ التحميل…</p>:shares.length?<ul className="share-list">{shares.map(s=><li key={s.recipient_email}><bdi>{s.recipient_email}</bdi><button type="button" className="button secondary" disabled={busy} onClick={()=>remove(s.recipient_email)}>إيقاف الوصول</button></li>)}</ul>:<p className="muted">ما شاركت الخطة مع أي شخص بعد.</p>}
  </section>;
}
