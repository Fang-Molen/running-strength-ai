// @ts-nocheck -- supplied pure module, host validates inputs
// FANGKUN nutrition catalogue: audited per product and jurisdiction; data are intentionally sparse.
// NULL is missing, never 0. Do not copy US product figures to China.
export const CATALOG_VERSION = 'NH-CATALOG-2026-10-16-R1';
const verified = ({id,name,brand,region,category='汉堡',kcal,protein=null,carbs=null,fat=null,unit='个',amount=1,source,reviewDate='2026-10-16',sourcePublished='页面当前展示',status='BRAND_REPORTED',emoji='🍔',variant='',notes=''})=>({id,name,brand,region,category,unit,amount,nutrients:{kcal,protein,carbs,fat},source:{kind:'OFFICIAL_BRAND',status,uri:source,checkedOn:reviewDate,publishedOn:sourcePublished,notes},emoji,variant});
const estimate=({id,name,category,per100,kcal,protein=null,carbs=null,fat=null,emoji='🍽️',notes=''})=>({id,name,brand:'通用食材',region:'通用估算',category,unit:'g',amount:100,per100g:true,nutrients:{kcal,protein,carbs,fat},source:{kind:'DEMO_ESTIMATE',status:'UNVERIFIED',uri:null,checkedOn:null,publishedOn:null,notes:notes||'仅为示例估算值，需按实物标签或可靠成分数据库核对。'},emoji,variant:''});
const pending=({id,name,brand,region='中国大陆',category='汉堡',emoji='🍔',variant='',notes=''})=>({id,name,brand,region,category,unit:'个',amount:1,nutrients:{kcal:null,protein:null,carbs:null,fat:null},source:{kind:'BRAND_ITEM',status:'PENDING_LABEL',uri:null,checkedOn:null,publishedOn:null,notes:notes||'未核到该地区该产品的可靠营养标签，请拍摄包装/菜单标示或手动输入。'},emoji,variant});
export const FOODS=Object.freeze([
 verified({id:'mcd-us-big-mac-2026',name:'巨无霸 Big Mac',brand:'麦当劳 McDonald’s',region:'美国',kcal:580,protein:25,carbs:45,fat:34,source:'https://www.mcdonalds.com/us/en-us/product/big-mac.html',variant:'美国产品；单个汉堡，不含套餐'}),
 verified({id:'mcd-us-cheese-2026',name:'芝士汉堡 Cheeseburger',brand:'麦当劳 McDonald’s',region:'美国',kcal:300,source:'https://www.mcdonalds.com/us/en-us/product/cheeseburger.html',variant:'美国产品；单个汉堡，不含套餐',notes:'网页确认能量；三大营养素未在此次公开页面核实，因此留空。'}),
 verified({id:'mcd-us-quarter-cheese-2026',name:'足三两芝士牛肉堡 Quarter Pounder with Cheese',brand:'麦当劳 McDonald’s',region:'美国',kcal:520,source:'https://www.mcdonalds.com/us/es-us/product/quarter-pounder-with-cheese.html',variant:'美国产品；单个汉堡，不含套餐'}),
 verified({id:'bk-us-whopper-2022',name:'皇堡 WHOPPER® Sandwich',brand:'汉堡王 Burger King',region:'美国',kcal:660,protein:28,carbs:49,fat:40,source:'https://originqa.bk.com/services/pdf/download/nutrition',sourcePublished:'2022年4月营养表',status:'HISTORICAL_RECHECK',variant:'美国历史数据；不应视为2026最新产品',notes:'历史BK美国官方营养PDF（2022）记录660 kcal；官方2026帮助页指向新版 Nutrition Explorer，请重新核验。'}),
 verified({id:'bk-us-whopper-cheese-2020',name:'芝士皇堡 WHOPPER with Cheese',brand:'汉堡王 Burger King',region:'美国',kcal:740,protein:32,carbs:50,fat:46,source:'https://origin.bk.com/pdfs/nutrition.pdf',sourcePublished:'2020年4月营养表',status:'HISTORICAL_RECHECK',variant:'美国2020历史版本；不可当作当前值'}),
 pending({id:'mcd-cn-bigmac',name:'巨无霸（中国大陆版）',brand:'麦当劳 McDonald’s',variant:'需中国大陆官方营养标签；不可套用美国580 kcal'}),
 pending({id:'mcd-cn-spicychicken',name:'麦辣鸡腿堡',brand:'麦当劳 McDonald’s',variant:'中国大陆'},),
 pending({id:'kfc-cn-spicy',name:'香辣鸡腿堡',brand:'肯德基 KFC',variant:'中国大陆'}),
 pending({id:'bk-cn-whopper',name:'皇堡（中国大陆版）',brand:'汉堡王 Burger King',variant:'中国大陆'}),
 pending({id:'tastien-cn-beef',name:'牛肉中国汉堡（具体口味待确认）',brand:'塔斯汀',variant:'门店/规格不同，待具体型号及标签'}),
 pending({id:'wallace-cn-chicken',name:'香辣鸡腿堡（具体规格待确认）',brand:'华莱士',variant:'规格待核对'}),
 pending({id:'dicos-cn-crispy',name:'鸡腿堡（具体规格待确认）',brand:'德克士',variant:'规格待核对'}),
 pending({id:'mcd-cn-fries',name:'薯条（规格未定）',brand:'麦当劳 McDonald’s',region:'中国大陆',category:'小食',emoji:'🍟',variant:'需要小/中/大规格'}),
 pending({id:'kfc-cn-drink',name:'可乐（杯型未定）',brand:'肯德基 KFC',region:'中国大陆',category:'饮品',emoji:'🥤',variant:'需要杯型与糖分选项'}),
 // 面食按称量状态拆分：未煮干面、生鲜湿面、煮熟面，100g不可相互替换。
 estimate({id:'n-dry-uncooked',name:'干面条（未煮·干重）',category:'面食',kcal:351,protein:11.0,carbs:71.0,fat:1.4,emoji:'🍜',notes:'示例值，不同品牌及配方需核实；此100克是干重，不是煮后称重。'}),
 estimate({id:'n-fresh-uncooked',name:'生鲜湿面（未煮·生重）',category:'面食',kcal:270,protein:8.8,carbs:53.5,fat:1.7,emoji:'🍝',notes:'示例值，因添加水分比例不同，实际差异较大；需核对包装。'}),
 estimate({id:'n-cooked-drained',name:'熟面条（煮后沥水称重）',category:'面食',kcal:138,protein:4.8,carbs:28.0,fat:0.8,emoji:'🍜',notes:'煮后沥水的面条示例值；吸水率随粗细、煮法和品种而改变。'}),
 pending({id:'n-prepared-dry-mix',name:'干拌面（成品含酱料）',brand:'通用菜品',region:'中国大陆',category:'面食',emoji:'🥢',variant:'需要面条干重/熟重、酱油、油脂、肉与配料；不可只按煮熟面条计算'}),
 pending({id:'n-soup-noodle-whole',name:'汤面（整碗含汤与配料）',brand:'通用菜品',region:'中国大陆',category:'面食',emoji:'🍲',variant:'需分开登记面条熟重、汤、油、肉、菜；整碗100g不等于面条100g'}),
 estimate({id:'g-rice',name:'熟白米饭',category:'主食',kcal:130,protein:2.7,carbs:28.2,fat:0.3,emoji:'🍚'}),
 estimate({id:'g-banana',name:'香蕉可食部',category:'水果',kcal:89,protein:1.1,carbs:22.8,fat:0.3,emoji:'🍌'}),
 estimate({id:'g-apple',name:'苹果可食部',category:'水果',kcal:52,protein:0.3,carbs:13.8,fat:0.2,emoji:'🍎'}),
 estimate({id:'g-chicken',name:'熟鸡胸肉（不含额外油）',category:'蛋白质',kcal:165,protein:31,carbs:0,fat:3.6,emoji:'🍗'}),
 estimate({id:'g-egg',name:'全蛋（熟）',category:'蛋白质',kcal:155,protein:12.6,carbs:1.1,fat:10.6,emoji:'🥚'}),
 estimate({id:'g-oats',name:'燕麦片（干）',category:'主食',kcal:389,protein:16.9,carbs:66.3,fat:6.9,emoji:'🥣'}),
 estimate({id:'g-broccoli',name:'西兰花（生）',category:'蔬菜',kcal:34,protein:2.8,carbs:6.6,fat:0.4,emoji:'🥦'}),
 estimate({id:'g-tomato',name:'番茄（生）',category:'蔬菜',kcal:18,protein:0.9,carbs:3.9,fat:0.2,emoji:'🍅'}),
 estimate({id:'g-wholemilk',name:'全脂牛奶（参考）',category:'饮品',kcal:61,protein:3.2,carbs:4.8,fat:3.3,emoji:'🥛'}),
 estimate({id:'g-beef',name:'熟瘦牛肉',category:'蛋白质',kcal:217,protein:26,carbs:0,fat:12,emoji:'🥩'}),
 estimate({id:'g-bread',name:'全麦面包（参考）',category:'主食',kcal:247,protein:13,carbs:41,fat:4.2,emoji:'🍞'}),
 estimate({id:'g-salmon',name:'熟三文鱼（参考）',category:'蛋白质',kcal:206,protein:22,carbs:0,fat:12,emoji:'🐟'}),
 estimate({id:'g-peanutbutter',name:'花生酱（参考）',category:'小食',kcal:588,protein:25,carbs:20,fat:50,emoji:'🥜'}),
 estimate({id:'g-water',name:'饮用水',category:'饮品',kcal:0,protein:0,carbs:0,fat:0,emoji:'💧',notes:'水无能量，以上0并非缺失。'}),
]);
export const CATEGORY_NAMES=['全部','汉堡','面食','主食','蛋白质','蔬菜','水果','小食','饮品'];
export const STATUS_LABELS={BRAND_REPORTED:'官网当前展示',HISTORICAL_RECHECK:'品牌旧版·待复核',UNVERIFIED:'通用估算·未核验',PENDING_LABEL:'待标签核实',USER_LABEL:'用户录入标签'};
export const findFood=(id,custom=[])=>[...FOODS,...custom].find(x=>x.id===id)||null;
