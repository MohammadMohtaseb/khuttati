import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {normalizedFood,cookedWeightEstimate,fitTarget,recipeRequest,compatibleCooked,safeSteps,lookupIndexed} from '../worker/recipe.js';
import {recipeTotals,cookedComplete} from '../src/recipeMath.js';

const food=(description,per100,water=60)=>({fdcId:1,description,dataType:'Foundation',foodNutrients:[
  {nutrientId:1008,value:per100.kcal},{nutrientId:1003,value:per100.protein},
  {nutrientId:1004,value:per100.fat},{nutrientId:1005,value:per100.carbs},{nutrientId:1051,value:water}
]});

test('USDA nutrients and raw/cooked weights are distinct',()=>{
  const raw=normalizedFood(food('Rice, white, raw',{kcal:360,protein:7,fat:1,carbs:80},12));
  const cooked=normalizedFood(food('Rice, white, cooked',{kcal:130,protein:2.7,fat:.3,carbs:28},68));
  assert.equal(cookedWeightEstimate(100,raw,cooked),275);
  const ingredients=[{rawGrams:100,cookedGrams:275,raw,cooked}];
  assert.equal(recipeTotals(ingredients).kcal,360);
  assert.equal(recipeTotals(ingredients,'cooked').kcal,357.5);
  assert.equal(cookedComplete(ingredients),true);
});

test('numeric target fitting uses data values, not AI macro claims',()=>{
  const items=[{rawGrams:100,minGrams:50,maxGrams:200,raw:{per100:{kcal:100,protein:20}}}];
  fitTarget(items,{kcal:150,protein:30});
  assert.equal(items[0].rawGrams,150);
});

test('cooked food match excludes breaded or oiled variants and unsafe poultry washing',()=>{
  assert.equal(compatibleCooked('Chicken breast tenders, breaded, cooked, microwaved','Chicken breast boneless skinless raw',''),false);
  assert.equal(compatibleCooked('Chicken breast skinless boneless cooked grilled','Chicken breast boneless skinless raw','grilled'),true);
  assert.equal(compatibleCooked('Rice white cooked made with oil','Rice white raw',''),false);
  const steps=safeSteps(['اغسل صدور الدجاج جيدًا.','اطبخ الأرز بالماء.'],true);
  assert.equal(steps.some(x=>x.includes('اغسل صدور')),false);
  assert.equal(steps.some(x=>x.includes('74°م')),true);
  assert.equal(cookedComplete([{cookingExpected:true,cooked:null,cookedGrams:null}]),false);
  assert.equal(safeSteps(['ضع صدور الدجاج في وعاء واغمرها بالماء','اشوِ الدجاج حتى ينضج'],true,'دجاج مشوي').some(x=>x.includes('اغمرها بالماء')),false);
});

test('offline USDA index matches plain raw food and corresponding cooked food',()=>{
  const index=JSON.parse(fs.readFileSync(new URL('../public/usda-sr-legacy-2018.json',import.meta.url)));
  const chicken=lookupIndexed(index,'chicken breast boneless skinless raw','raw','','',true);
  assert.match(chicken.description,/breast.*skinless.*raw/i);
  assert.equal(chicken.per100.kcal,120);
  const cookedChicken=lookupIndexed(index,`${chicken.description.replace(/raw/i,'')} cooked`,'cooked',chicken.description,'grilled');
  assert.match(cookedChicken.description,/breast.*grilled/i);
  const rice=lookupIndexed(index,'rice white long grain raw','raw','','',true);
  assert.match(rice.description,/rice.*white.*raw/i);
  assert.doesNotMatch(rice.description,/beans|cooked|wild/i);
  const cookedRice=lookupIndexed(index,`${rice.description.replace(/raw/i,'')} cooked`,'cooked',rice.description,'boiled');
  assert.match(cookedRice.description,/rice.*white.*cooked/i);
  assert.doesNotMatch(cookedRice.description,/wild|fat added/i);
  assert.match(lookupIndexed(index,'egg whole raw','raw','','',true).description,/egg.*raw.*fresh/i);
  assert.match(lookupIndexed(index,'yogurt greek plain nonfat','raw').description,/plain.*nonfat/i);
});

test('recipe endpoint rejects missing user before calling AI',async()=>{
  let invoked=false;
  const req=new Request('https://khuttati.pages.dev/api/recipe',{method:'POST',body:'{}'});
  const result=await recipeRequest(req,{AI:{run(){invoked=true}}});
  assert.equal(result.status,401);assert.equal(invoked,false);
});

test('recipe endpoint trusts a complete label instead of fetching USDA',async()=>{
  const original=globalThis.fetch;
  const visited=[];
  globalThis.fetch=async url=>{visited.push(String(url));return new Response('{}',{status:200})};
  try{
    const req=new Request('https://khuttati.pages.dev/api/recipe',{method:'POST',headers:{Authorization:'Bearer token.example',apikey:'sb_publishable_test','Content-Type':'application/json'},body:JSON.stringify({pantry:'لبنة',meal:'فطور',target:{kcal:200,protein:10},labels:[{pantryIndex:0,per100:{kcal:180,protein:10,carbs:4,fat:14}}]})});
    const result=await recipeRequest(req,{AI:{run:async()=>({response:{title:'لبنة',steps:['قدّمها.'],ingredients:[{pantryIndex:0,nameAr:'لبنة',rawQuery:'labneh',cookedQuery:'',rawGrams:100,availableGrams:0}]}})}});
    const body=await result.json();
    assert.equal(result.status,200);
    assert.equal(body.recipe.ingredients[0].raw.dataType,'Label');
    assert.equal(body.recipe.ingredients[0].raw.per100.protein,10);
    assert.equal(visited.length,1);
    assert.match(visited[0],/supabase.co\/auth\/v1\/user/);
  }finally{globalThis.fetch=original}
});
