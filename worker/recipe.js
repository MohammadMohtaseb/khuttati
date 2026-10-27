// Cloudflare Pages advanced-mode worker. AI writes the recipe; USDA/label data supply every number.
const SUPABASE_URL = 'https://xrkfnfvhysxftgptkmvg.supabase.co';
const MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
const NUTRIENTS = {protein:1003,fat:1004,carbs:1005,water:1051};
const json = (value,status=200) => Response.json(value,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
const finite = value => Number.isFinite(Number(value)) ? Number(value) : NaN;
const text = (value,max=100) => String(value||'').trim().slice(0,max);

async function authenticated(request){
  const bearer=request.headers.get('Authorization')||'';
  const key=request.headers.get('apikey')||'';
  if(!/^Bearer [A-Za-z0-9._-]+$/.test(bearer)||!key.startsWith('sb_publishable_'))return false;
  const check=await fetch(`${SUPABASE_URL}/auth/v1/user`,{headers:{Authorization:bearer,apikey:key}});
  return check.ok;
}

function nutrient(food,id){
  return food.foodNutrients?.find(n=>Number(n.nutrientId??n.nutrient?.id)===id)?.value;
}

export function normalizedFood(food){
  const protein=finite(nutrient(food,NUTRIENTS.protein));
  const fat=finite(nutrient(food,NUTRIENTS.fat));
  const carbs=finite(nutrient(food,NUTRIENTS.carbs));
  const energy=[1008,2047,2048].map(id=>finite(nutrient(food,id))).find(Number.isFinite);
  if(![protein,fat,carbs,energy].every(Number.isFinite))return null;
  return {fdcId:food.fdcId,description:food.description,dataType:food.dataType,
    per100:{kcal:energy,protein,fat,carbs},water:finite(nutrient(food,NUTRIENTS.water))};
}

function foodScore(food,query,form){
  const d=food.description.toLowerCase(),terms=query.toLowerCase().split(/[^a-z]+/).filter(w=>w.length>2);
  let score=terms.reduce((n,t)=>n+(d.includes(t)?2:-1),0);
  if(d.includes(query.toLowerCase()))score+=8;
  if(food.dataType==='Foundation')score+=3;
  if(food.dataType==='SR Legacy')score+=2;
  if(food.dataType==='Branded')score-=15;
  if(form==='raw')score+=d.includes('raw')?5:d.includes('cooked')?-8:0;
  if(form==='cooked')score+=/cooked|grilled|boiled|roasted|baked|fried|steamed/.test(d)?5:d.includes('raw')?-8:0;
  if(/\band\b/.test(d)&&!/\band\b/.test(query))score-=8;
  if(/with (?:sauce|gravy|vegetables|beans|rice)|breaded|battered|rotisserie|fat added|with added solution/.test(d))score-=15;
  for(const detail of ['frozen','salted','sweetened','strawberry','vanilla','chobani','flavored','duck','goose','quail','turkey'])if(d.includes(detail)&&!query.toLowerCase().includes(detail))score-=7;
  if(d.includes('fresh')&&query.toLowerCase().includes('egg'))score+=3;
  return score;
}

function rawSearch(pantry,aiQuery,cookingExpected){
  const name=pantry.toLowerCase();
  if(/(?:(?:صدر|صدور)\s*دجاج|دجاج\s*(?:صدر|صدور))/.test(name))return 'chicken breast boneless skinless raw';
  if(/(?:أرز|ارز|رز)\s*(?:أبيض|ابيض)/.test(name))return 'rice white long grain raw';
  if(/(?:أرز|ارز|رز)\s*(?:أسمر|بني)/.test(name))return 'rice brown long grain raw';
  if(/(?:بيض|بيضة)/.test(name))return 'egg whole raw';
  if(/(?:بطاطا|بطاطس)/.test(name))return 'potato raw';
  if(/(?:زيت زيتون|olive oil)/.test(name))return 'oil olive salad or cooking';
  if(/(?:زبادي|لبن|يوغورت).*يوناني|(?:yogurt|yoghurt).*greek/i.test(name))return /(?:خالي|صفر|nonfat|fat.?free)/i.test(name)?'yogurt greek plain nonfat':/(?:قليل|lowfat|low fat)/i.test(name)?'yogurt greek plain lowfat':'yogurt greek plain';
  const query=text(aiQuery,80).replace(/\b(cooked|grilled|boiled|roasted|baked|fried)\b/ig,'').trim();
  return cookingExpected&&!/\b(raw|uncooked|dry)\b/i.test(query)?`${query} raw`:query;
}

export function compatibleCooked(description,rawDescription,method){
  const cooked=description.toLowerCase(),raw=rawDescription.toLowerCase();
  if(/breaded|battered|with oil|made with oil|with butter|with margarine|with added solution|with sauce|fat added|wild|rotisserie|pre-cooked/.test(cooked))return false;
  if(cooked.includes('parboiled')&&!raw.includes('parboiled'))return false;
  if(cooked.includes('with salt')&&!raw.includes('salt'))return false;
  for(const word of ['chicken','turkey','breast','thigh','rice','white','brown','pasta','salmon','tuna','potato','egg'])if(raw.includes(word)&&!cooked.includes(word))return false;
  if((raw.includes('skinless')||raw.includes('boneless'))&&!cooked.includes('meat only')&&!cooked.includes('skinless'))return false;
  if(method==='grilled'&&!/grilled|broiled/.test(cooked))return false;
  if(method==='roasted'&&!/roasted|baked/.test(cooked))return false;
  if(method==='fried'&&!/fried/.test(cooked))return false;
  if(method==='steamed'&&!/steamed/.test(cooked))return false;
  if(method==='boiled'&&!/boiled|braised|cooked/.test(cooked))return false;
  return true;
}

let indexPromise;
async function foodIndex(env,request){
  if(!indexPromise)indexPromise=env.ASSETS.fetch(new Request(new URL('/usda-sr-legacy-2018.json',request.url))).then(r=>{
    if(!r.ok)throw new Error('تعذر تحميل قاعدة الغذاء.');
    return r.json();
  }).catch(error=>{indexPromise=null;throw error});
  return indexPromise;
}

export function lookupIndexed(index,query,form,rawReference='',method='',requiresRaw=false){
  const terms=query.toLowerCase().split(/[^a-z]+/).filter(w=>w.length>2);
  const scored=[];
  for(const [fdcId,description,kcal,protein,fat,carbs,water,dataType] of index){
    const lower=description.toLowerCase();
    if(requiresRaw&&!/\braw\b|uncooked|\bdry\b/.test(lower))continue;
    if(form==='cooked'&&(!/cooked|grilled|boiled|roasted|baked|fried|steamed/.test(lower)||!compatibleCooked(description,rawReference,method)))continue;
    if(form==='raw'&&/cooked|grilled|boiled|roasted|baked|fried|steamed/.test(lower))continue;
    const match=terms.filter(t=>lower.includes(t)).length;
    if(terms.length&&match/terms.length<.55)continue;
    const score=foodScore({description,dataType},query,form)+match/Math.max(terms.length,1)*3;
    scored.push({score,food:{fdcId,description,dataType,per100:{kcal,protein,fat,carbs},water:Number.isFinite(water)?water:NaN}});
  }
  scored.sort((a,b)=>b.score-a.score);
  return scored[0]?.score>=3?scored[0].food:null;
}

export function cookedWeightEstimate(rawGrams,raw,cooked){
  if(!raw||!cooked||!Number.isFinite(raw.water)||!Number.isFinite(cooked.water)||cooked.water>=99)return null;
  // Dry-matter estimate; actual cooked yield may differ when fat or solids are lost.
  const weight=rawGrams*(100-raw.water)/(100-cooked.water);
  return weight>=rawGrams*.45&&weight<=rawGrams*4?Math.round(weight):null;
}

const total=items=>items.reduce((a,x)=>({kcal:a.kcal+x.raw.per100.kcal*x.rawGrams/100,protein:a.protein+x.raw.per100.protein*x.rawGrams/100}),{kcal:0,protein:0});
export function fitTarget(items,target){
  if(!items.length)return items;
  const score=() => {const t=total(items);return Math.pow((t.kcal-target.kcal)/target.kcal,2)+2*Math.pow((t.protein-target.protein)/target.protein,2)};
  let best=score();
  for(const step of [25,10,5])for(let pass=0;pass<10;pass++){
    let improved=false;
    for(const item of items)for(const direction of [-1,1]){
      const prior=item.rawGrams,next=prior+direction*step;
      if(next<item.minGrams||next>item.maxGrams)continue;
      item.rawGrams=next;const value=score();
      if(value+1e-8<best){best=value;improved=true}else item.rawGrams=prior;
    }
    if(!improved)break;
  }
  return items;
}

const recipeSchema={type:'object',properties:{title:{type:'string'},steps:{type:'array',items:{type:'string'}},ingredients:{type:'array',items:{type:'object',properties:{pantryIndex:{type:'integer'},nameAr:{type:'string'},rawQuery:{type:'string'},cookedQuery:{type:'string'},rawGrams:{type:'number'},availableGrams:{type:'number'}},required:['pantryIndex','nameAr','rawQuery','cookedQuery','rawGrams','availableGrams']}}},required:['title','steps','ingredients']};

async function propose(env,pantry,target,meal){
  if(!env.AI)throw new Error('خدمة اقتراح الوصفات غير مفعّلة حاليًا.');
  const prompt=`اقترح وصفة عربية منزلية واحدة من المواد المذكورة فقط. الوجبة: ${meal}. المواد مرقمة: ${pantry.map((x,i)=>`${i}: ${x}`).join(' | ')}. الهدف التقريبي ${target.kcal} سعرة و${target.protein} غ بروتين. اختر حتى 5 مواد مستخدمة فعلًا. أرجع index مطابقًا للقائمة، اسمًا عربيًا، وزنًا نيئًا صالحًا للأكل بالغرام، availableGrams إن ذكرت كمية متاحة وإلا 0، وعبارة بحث إنجليزية محددة في USDA للحالة النيئة rawQuery، وللمطبوخة cookedQuery إذا ستُطبخ. للدجاج والأرز واللحم والسمك والبيض والباستا المطبوخة يجب ملء cookedQuery. لا تدخل زيتًا أو صلصة أو مكوّنًا غير مذكور. لا تقدّر السعرات أو الماكروز. الخطوات قصيرة وصالحة للطهو الآمن؛ لا تغسل الدجاج أو اللحم النيء، والملح والماء مسموحان في الخطوات لكن لا تضفهما لقائمة المكونات.`;
  let result;
  try{result=await env.AI.run(MODEL,{messages:[{role:'system',content:'You are a recipe designer. Respond with JSON matching the schema. Use only the listed pantry items. Never provide nutritional numbers.'},{role:'user',content:prompt}],response_format:{type:'json_schema',json_schema:recipeSchema},max_tokens:900,temperature:.35})}
  catch{throw new Error('خدمة اقتراح الوصفات مشغولة حاليًا. جرّب بعد قليل.');}
  const value=typeof result.response==='string'?JSON.parse(result.response):result.response;
  if(!value||!Array.isArray(value.ingredients)||!value.ingredients.length)throw new Error('تعذر تكوين وصفة من هذه المكونات. وضّح الأسماء والكميات وجرب مرة ثانية.');
  return value;
}

export async function recipeRequest(request,env){
  if(request.method!=='POST')return json({error:'الطريقة غير مدعومة.'},405);
  if(!(await authenticated(request)))return json({error:'سجّل الدخول أولًا.'},401);
  if(Number(request.headers.get('Content-Length')||0)>6000)return json({error:'الطلب كبير جدًا.'},413);
  let input;
  try{input=await request.json()}catch{return json({error:'الطلب غير صالح.'},400)}
  const pantry=String(input.pantry||'').split(/[،,\n]+/).map(s=>text(s,70)).filter(Boolean).slice(0,10);
  const target={kcal:finite(input.target?.kcal),protein:finite(input.target?.protein)};
  const meal=text(input.meal,30);
  const labels=Array.isArray(input.labels)?input.labels.slice(0,5):[];
  if(!pantry.length||pantry.join('').length>350||!Number.isFinite(target.kcal)||target.kcal<150||target.kcal>1500||!Number.isFinite(target.protein)||target.protein<5||target.protein>130)return json({error:'أدخل المكونات وهدف سعرات وبروتين مناسبًا للوجبة.'},400);
  const validLabels=new Map();
  for(const label of labels){
    const index=Number(label.pantryIndex),values=label.per100;
    if(!Number.isInteger(index)||index<0||index>=pantry.length||!values)continue;
    const macros={kcal:finite(values.kcal),protein:finite(values.protein),fat:finite(values.fat),carbs:finite(values.carbs)};
    if(!Object.values(macros).every(Number.isFinite)||macros.kcal<0||macros.kcal>900||macros.protein<0||macros.protein>100||macros.fat<0||macros.fat>100||macros.carbs<0||macros.carbs>100)continue;
    validLabels.set(index,macros);
  }
  try{
    const suggestion=await propose(env,pantry,target,meal);
    const rawItems=suggestion.ingredients.slice(0,5);
    if(rawItems.some(x=>!Number.isInteger(x.pantryIndex)||x.pantryIndex<0||x.pantryIndex>=pantry.length))throw new Error('الاقتراح تضمّن مكوّنًا خارج قائمتك. أعد المحاولة.');
    const items=[];
    for(const part of rawItems){
      const rawGrams=Math.round(finite(part.rawGrams)/5)*5;
      if(!Number.isFinite(rawGrams)||rawGrams<10||rawGrams>500)throw new Error('تعذّر تحديد كمية موثوقة لإحدى المواد.');
      const label=validLabels.get(part.pantryIndex);
      const cookedQuery=text(part.cookedQuery,90);
      const rawQuery=rawSearch(pantry[part.pantryIndex],part.rawQuery,!!cookedQuery);
      const index=label?null:await foodIndex(env,request);
      const raw=label?{description:`ملصق ${pantry[part.pantryIndex]}`,dataType:'Label',per100:label,water:NaN,fdcId:null}:lookupIndexed(index,rawQuery,'raw','','',!!cookedQuery);
      if(!raw)throw new Error(`لم نجد قيمة موثوقة لـ«${pantry[part.pantryIndex]}». أضف قيم الملصق لكل 100غ أو جرّب اسمًا أوضح.`);
      const titleMethod=/مشوي|شوي|grill/i.test(suggestion.title)?'grilled':/مقلي|قلي|fried/i.test(suggestion.title)?'fried':/مخبوز|خبز|baked/i.test(suggestion.title)?'baked':'';
      const meatLike=/chicken|turkey|beef|lamb|fish|salmon|tuna/i.test(raw.description);
      const cookingMethod=(meatLike&&titleMethod)||(cookedQuery.match(/grilled|broiled|roasted|baked|fried|steamed|boiled/i)||[])[0]?.toLowerCase()||'';
      const derivedCookedQuery=raw.description.replace(/\braw\b/ig,'').replace(/[,]/g,' ').replace(/\s+/g,' ').trim()+' cooked';
      const cooked=!label&&cookedQuery?lookupIndexed(index,derivedCookedQuery,'cooked',raw.description,cookingMethod):null;
      const available=finite(part.availableGrams);
      items.push({name:text(part.nameAr,70)||pantry[part.pantryIndex],pantry:pantry[part.pantryIndex],rawGrams,cookingExpected:!!cookedQuery,
        minGrams:10,maxGrams:Number.isFinite(available)&&available>=10?Math.min(500,Math.max(rawGrams,available)):Math.min(500,Math.max(rawGrams,Math.round(rawGrams*1.5))),raw,cooked});
    }
    fitTarget(items,target);
    const output=items.map(({minGrams,maxGrams,...item})=>({...item,cookedGrams:cookedWeightEstimate(item.rawGrams,item.raw,item.cooked)}));
    const steps=safeSteps(suggestion.steps||[],items.some(x=>/chicken|turkey/i.test(x.raw.description)),suggestion.title);
    return json({recipe:{title:text(suggestion.title,90),steps,ingredients:output,target,meal,estimated:true,source:'USDA FoodData Central (SR Legacy 2018 / Foundation 2026) + optional product labels'}});
  }catch(error){return json({error:error.message||'تعذر إنشاء الوصفة الآن. حاول لاحقًا.'},502)}
}

export function safeSteps(generated,poultry,title=''){
  const grilling=/مشوي|شوي|grill/i.test(title);
  const steps=generated.slice(0,6).map(s=>text(s,250)).filter(s=>!((/(?:اغسل|اشطف|انقع|wash|rinse)/i.test(s)&&/(?:دجاج|لحم|سمك|chicken|meat|fish)/i.test(s))||(grilling&&/(?:اغمر|ضع)/i.test(s)&&/(?:صدر|دجاج|لحم|chicken|meat)/i.test(s)&&/(?:الماء|ماء)/i.test(s))));
  if(poultry)steps.push('لا تغسل الدجاج النيّئ، وافصله عن الطعام الجاهز. اطهه حتى تصل حرارته الداخلية إلى 74°م باستخدام ميزان حرارة للطعام.');
  return steps;
}

export default {fetch(request,env){
  const url=new URL(request.url);
  if(url.pathname==='/api/recipe')return recipeRequest(request,env);
  return env.ASSETS.fetch(request);
}};
