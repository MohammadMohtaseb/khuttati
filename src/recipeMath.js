export const round = (number,digits=1) => Math.round((Number(number)||0)*10**digits)/10**digits;

export function recipeTotals(ingredients,form='raw'){
  return ingredients.reduce((totals,item)=>{
    const food=form==='cooked'&&item.cooked&&Number(item.cookedGrams)>0?item.cooked:item.raw;
    const grams=form==='cooked'&&item.cooked&&Number(item.cookedGrams)>0?Number(item.cookedGrams):Number(item.rawGrams);
    for(const key of ['kcal','protein','carbs','fat'])totals[key]+=Number(food.per100[key]||0)*grams/100;
    return totals;
  },{kcal:0,protein:0,carbs:0,fat:0});
}

export function cookedComplete(ingredients){return ingredients.every(item=>!item.cookingExpected||(item.cooked&&Number(item.cookedGrams)>0))}
