import React,{useMemo,useState} from 'react';
import {ChefHat,Plus,Trash2,Sparkles,Save,UtensilsCrossed} from 'lucide-react';
import {supabase,saveRecord} from './store';
import {recipeTotals,round,cookedComplete} from './recipeMath';

const emptyLabel=()=>({name:'',kcal:'',protein:'',carbs:'',fat:''});
const nutrientNames={kcal:'سعرة',protein:'بروتين',carbs:'كارب',fat:'دهون'};
const Nutrients=({values})=><div className="recipe-macros">{Object.entries(nutrientNames).map(([key,label])=><div key={key}><strong>{round(values[key],key==='kcal'?0:1)}</strong><span>{label}{key==='kcal'?'':' · غ'}</span></div>)}</div>;

export default function RecipeLab({records,date,act}){
  const [pantry,setPantry]=useState(''),[meal,setMeal]=useState('غداء'),[target,setTarget]=useState({kcal:'',protein:''});
  const [labels,setLabels]=useState([]),[recipe,setRecipe]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const saved=Object.entries(records).filter(([key,value])=>key.startsWith('recipe:')&&!value.deleted).sort((a,b)=>(b[1].savedAt||'').localeCompare(a[1].savedAt||''));
  const raw=useMemo(()=>recipe?recipeTotals(recipe.ingredients):null,[recipe]);
  const cooked=useMemo(()=>recipe?recipeTotals(recipe.ingredients,'cooked'):null,[recipe]);
  const ready=recipe&&cookedComplete(recipe.ingredients);
  async function suggest(event){
    event.preventDefault();setError('');setBusy(true);setRecipe(null);
    try{
      const base=pantry.split(/[،,\n]+/).map(s=>s.trim()).filter(Boolean);
      const extras=labels.filter(x=>x.name.trim());
      if(extras.some(x=>['kcal','protein','carbs','fat'].some(k=>x[k]===''||!Number.isFinite(Number(x[k])))))throw new Error('أكمل قيم الملصق لكل 100 غرام أو احذف المنتج.');
      const names=[...base,...extras.map(x=>x.name.trim())];
      const {data:sessionResult,error:sessionError}=await supabase.auth.getSession();
      if(sessionError||!sessionResult.session)throw new Error('سجّل الدخول لإنشاء وصفة.');
      const result=await fetch('/api/recipe',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${sessionResult.session.access_token}`,apikey:import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY},body:JSON.stringify({pantry:names.join('، '),meal,target:{kcal:Number(target.kcal),protein:Number(target.protein)},labels:extras.map((x,i)=>({pantryIndex:base.length+i,per100:Object.fromEntries(['kcal','protein','carbs','fat'].map(k=>[k,Number(x[k])]))}))})});
      const body=await result.json();
      if(!result.ok)throw new Error(body.error||'تعذر إنشاء الوصفة.');
      setRecipe({...body.recipe,createdAt:new Date().toISOString()});
    }catch(err){setError(err.message||'تعذر إنشاء الوصفة.')}finally{setBusy(false)}
  }
  function updateIngredient(index,field,value){setRecipe(current=>({...current,ingredients:current.ingredients.map((item,i)=>{
    if(i!==index)return item;
    if(field==='cookedGrams')return {...item,cookedGrams:value,cookedManual:true};
    const previous=Number(item.rawGrams),next=Number(value);
    return {...item,rawGrams:value,cookedGrams:item.cooked&&!item.cookedManual&&item.cookedGrams&&previous>0?Math.round(Number(item.cookedGrams)*next/previous):item.cookedGrams};
  })}))}
  async function save(){if(!recipe)return;const value={...recipe,savedAt:new Date().toISOString(),date};if(await act(()=>saveRecord(`recipe:${crypto.randomUUID()}`,value)))setError('')}
  async function logMeal(){if(!recipe)return;const macros=recipeTotals(recipe.ingredients);await act(()=>saveRecord(`journal:${crypto.randomUUID()}`,{date,kind:'meal',name:recipe.title,note:`وصفة بديلة · ${round(macros.kcal,0)} سعرة · بروتين ${round(macros.protein)} غ · كارب ${round(macros.carbs)} غ · دهون ${round(macros.fat)} غ`}))}
  return <div className="recipe-lab">
    <section className="recipe-hero card"><div><span className="eyebrow"><Sparkles size={16}/> بديل من الموجود في بيتك</span><h2>وصفة تناسب يومك.</h2><p>اكتب الموجود عندك وحدّد هدف هذه الوجبة. الذكاء الاصطناعي يقترح الطبخة، والحساب من USDA أو ملصق المنتج.</p></div><ChefHat size={58} aria-hidden="true"/></section>
    <div className="recipe-layout"><form className="card recipe-form" onSubmit={suggest}><h2>شو عندك اليوم؟</h2><label className="field"><span>المكونات المتوفرة</span><textarea value={pantry} onChange={e=>setPantry(e.target.value)} required rows={4} maxLength={350} placeholder="صدور دجاج، رز، بندورة، زيت زيتون — افصل بينها بفاصلة"/></label><div className="recipe-fields"><label className="field"><span>الوجبة</span><select value={meal} onChange={e=>setMeal(e.target.value)}>{['فطور','غداء','عشاء','سناك','قبل التمرين','بعد التمرين'].map(x=><option key={x}>{x}</option>)}</select></label><label className="field"><span>هدف السعرات للوجبة</span><input type="number" min="150" max="1500" required inputMode="numeric" value={target.kcal} onChange={e=>setTarget(x=>({...x,kcal:e.target.value}))} placeholder="مثلاً 500"/></label><label className="field"><span>هدف البروتين / غ</span><input type="number" min="5" max="130" required inputMode="numeric" value={target.protein} onChange={e=>setTarget(x=>({...x,protein:e.target.value}))} placeholder="مثلاً 35"/></label></div><p className="muted">أهداف الوجبة تدخلها أنت؛ الموقع ما يقسم خطتك اليومية من تلقاء نفسه.</p>
      <details className="recipe-labels"><summary>عندي منتج وقيمه على الملصق</summary><p className="muted">اختياري. أدخل القيم المكتوبة لكل 100 غرام، وهي تتقدم على بيانات USDA لهذا المنتج.</p>{labels.map((label,i)=><div className="recipe-label" key={i}><label className="field"><span>اسم المنتج</span><input value={label.name} onChange={e=>setLabels(current=>current.map((x,j)=>j===i?{...x,name:e.target.value}:x))} placeholder="مثلاً لبنة قليلة الدسم"/></label><div className="recipe-fields">{Object.entries(nutrientNames).map(([key,name])=><label className="field" key={key}><span>{name} / 100غ</span><input type="number" min="0" max={key==='kcal'?'900':'100'} step="0.1" inputMode="decimal" value={label[key]} onChange={e=>setLabels(current=>current.map((x,j)=>j===i?{...x,[key]:e.target.value}:x))}/></label>)}</div><button className="text-button" type="button" onClick={()=>setLabels(current=>current.filter((_,j)=>j!==i))}><Trash2 size={15}/> إزالة المنتج</button></div>)}<button className="button secondary" type="button" onClick={()=>setLabels(current=>[...current,emptyLabel()])} disabled={labels.length>=5}><Plus size={16}/> إضافة منتج</button></details>
      <button className="button" disabled={busy}>{busy?'جارٍ البحث وحساب القيم…':<><Sparkles size={17}/> اقترح وصفة محسوبة</>}</button>{error&&<p className="notice warning" role="alert">{error}</p>}
    </form><aside className="card recipe-guide"><h3>كيف نضمن وضوح الأرقام؟</h3><ol><li>المقادير الأساسية بالغرام قبل الطبخ.</li><li>نحسب الماكروز من سجل غذائي لكل مكوّن، أو من الملصق الذي أدخلته.</li><li>نعرض وزنًا مطبوخًا تقديريًا عندما تتوفر بيانات الماء للحالتين. يمكنك تغييره لوزنك الفعلي.</li><li>النتيجة تقديرية وتتغير مع نوع المنتج وطريقة الطبخ والزيت المضاف.</li></ol><a href="https://fdc.nal.usda.gov/" target="_blank" rel="noreferrer">مصدر البيانات: USDA FoodData Central ↗</a></aside></div>
    {recipe&&<section className="card recipe-result"><span className="eyebrow">وصفة بديلة مقترحة</span><h2>{recipe.title}</h2><p className="muted">للوصفة كاملة · قارنها بهدفك وأكّد الكميات قبل تسجيلها.</p><Nutrients values={raw}/><div className="recipe-target"><span>هدفك: {recipe.target.kcal} سعرة و{recipe.target.protein} غ بروتين</span><span>الفرق: {round(raw.kcal-Number(recipe.target.kcal),0)} سعرة · {round(raw.protein-Number(recipe.target.protein))} غ بروتين</span></div><h3>المقادير النيّة والقيم</h3><div className="recipe-ingredients">{recipe.ingredients.map((item,i)=><article key={i}><div><strong>{item.name}</strong><small>{item.raw.description} · {item.raw.dataType==='Label'?'ملصق المنتج':'USDA #'+item.raw.fdcId}</small></div><label>قبل الطبخ <input type="number" min="1" max="1000" step="1" value={item.rawGrams} onChange={e=>updateIngredient(i,'rawGrams',e.target.value)}/> غ</label>{item.cooked&&<label>بعد الطبخ <input type="number" min="1" max="4000" step="1" value={item.cookedGrams??''} onChange={e=>updateIngredient(i,'cookedGrams',e.target.value)} placeholder="زنه"/> غ <small>{item.cookedGrams?item.cookedManual?'وزنك الفعلي':'تقدير من بيانات الماء':'أدخل الوزن الفعلي'}</small></label>}{item.cooked&&<small>مصدر المطبوخ: {item.cooked.description} · USDA #{item.cooked.fdcId}</small>}</article>)}</div>
      {recipe.ingredients.some(x=>x.cookingExpected)&&(ready?<div className="recipe-cooked"><h3>حساب الوزن المطبوخ</h3><Nutrients values={cooked}/><p className="muted">هذه قيم تقديرية للحصة بعد الطبخ وفق الوزن الظاهر. استبدل الوزن التقديري بما قسته؛ فقد يتغيّر الماء أو تُفقد دهون ومكونات أثناء الطهو.</p></div>:<p className="notice">لا تتوفر بيانات مطبوخة مطابقة لكل المكونات وطريقة التحضير. يظهر حساب النيّ فقط حتى لا نعطيك إجماليًا مضللًا.</p>)}
      <h3>طريقة التحضير</h3><ol className="recipe-steps">{recipe.steps.map((step,i)=><li key={i}>{step}</li>)}</ol><div className="row-actions"><button className="button" onClick={save}><Save size={17}/> حفظ الوصفة في حسابي</button><button className="button secondary" onClick={logMeal}><UtensilsCrossed size={17}/> تسجيلها كوجبة اليوم</button></div><p className="tiny muted">الوصفة اقتراح بديل وليست تغييرًا لخطة التغذية الأصلية. إذا كانت لديك قيود صحية أو حساسية غذائية، راجع المكونات بنفسك.</p></section>}
    {!!saved.length&&<section className="card recipe-saved"><h2>وصفاتي المحفوظة</h2><div>{saved.map(([key,value])=><article key={key}><div><strong>{value.title}</strong><small>{value.date} · {round(recipeTotals(value.ingredients).kcal,0)} سعرة · {round(recipeTotals(value.ingredients).protein)} غ بروتين</small></div><button className="button secondary" onClick={()=>{setRecipe(value);window.scrollTo({top:0,behavior:'smooth'})}}>فتح</button><button className="icon-button" aria-label="حذف الوصفة" onClick={()=>{if(confirm('حذف هذه الوصفة من حسابك؟'))act(()=>saveRecord(key,{...value,deleted:true}))}}><Trash2 size={16}/></button></article>)}</div></section>}
  </div>;
}
