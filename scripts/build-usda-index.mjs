import fs from 'node:fs';

const source='release/usda/sr/FoodData_Central_sr_legacy_food_json_2018-04.json';
const output='public/usda-sr-legacy-2018.json';
const foods=[
  ...JSON.parse(fs.readFileSync(source,'utf8')).SRLegacyFoods.map(food=>({food,type:'SR Legacy'})),
  ...JSON.parse(fs.readFileSync('release/usda/foundation/FoodData_Central_foundation_food_json_2026-04-30.json','utf8')).FoundationFoods.map(food=>({food,type:'Foundation'})),
];
const ids=[1008,1003,1004,1005,1051];
const index=[];
for(const {food,type} of foods){
  if(!food?.foodNutrients)continue;
  const n=Object.fromEntries(food.foodNutrients.filter(x=>ids.includes(x.nutrient?.id)).map(x=>[x.nutrient.id,x.amount]));
  if(![1008,1003,1004,1005].every(id=>Number.isFinite(n[id])))continue;
  index.push([food.fdcId,food.description,...ids.map(id=>n[id]??null),type]);
}
fs.writeFileSync(output,JSON.stringify(index));
console.log(`${index.length} USDA SR Legacy and Foundation foods, ${fs.statSync(output).size} bytes`);
