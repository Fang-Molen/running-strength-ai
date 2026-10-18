"""Codex 自行生成，未参考外部封存题；公开开发/对抗语料，不是盲测集。"""
from pathlib import Path
import json
root=Path('src/lib/core/__fixtures__'); (root/'red-flags').mkdir(exist_ok=True,parents=True)
data={
 'HEAT':('EMERGENCY',['HEAT'],[
 '在三十四度的操场练完，问话总答非所问','桑拿天跑完身上又干又热，汗突然停了','伏天练球后反应迟钝','三十几度慢跑以后嘴里嘟囔，说不清话','烈日当头走跑交替后叫了没反应','大暑的露天训练中打寒颤','没热适应就在午后练，忽然抽搐','气温32℃，运动后不认人','夏季午间跑了一小时，皮肤干热','日头底下练后说化不清楚']),
 'CARDIOVASCULAR':('EMERGENCY',['CARDIOVASCULAR'],[
 '练完胸口像压着石头，左臂发麻','运动中前胸疼，脖子也疼','跑到坡顶心口堵，还冒冷汗','球赛后胸口紧，下巴疼','刚冲完胸部发闷，心扑腾','刚跑完胸门，还觉得气不够','今天训练胸口憋得慌，右臂酸','运动后胸口不舒服，眼前一白','刚骑车后胸部一阵疼，满头冷汗','练了二十分钟胸前像压了东西，颈部痛']),
 'SYNCOPE':('EMERGENCY',['SYNCOPE'],[
 '慢跑途中差点昏倒','练完站起来眼前发白','刚绕操场跑着跑着晕过去','运动时突然断片','今天热身后眼前一黑','训练中昏过去几秒','上坡刚跑完要晕了','刚打球险些倒下','运动后失去意识','刚跑完晕到在地上']),
 'NEUROLOGICAL':('URGENT_MEDICAL',['NEUROLOGICAL'],[
 '硬拉时腰疼，右腿一直发麻','刚练完腰背痛，左腿使不上劲','蹲起时腰闪了，腿有放电感','今天后背疼，双腿麻木','训练中腰痛，脚使不上力','刚搬完器械背痛，腿像过电','今天腰扭了，腿无力','练完脊柱周围疼，下肢电击感','刚跑后腰很痛，右腿没劲','训练后腰背疼，脚麻木']),
 'RESPIRATORY':('EMERGENCY',['RESPIRATORY'],[
 '练后喘不上气，站着也费劲','今天运动后嘴唇发紫','跑了一趟后一句话说不完','运动后呼吸困难','刚游完说不出完整句子','刚上坡嘴唇青紫','练球后严重气短','刚结束训练透不过气','运动后说句话就喘','跑完嘴唇发蓝']),
 'ENERGY':('MEDICAL_REVIEW',['ENERGY'],[
 '一直不吃主食还每天跑，能继续加跑吗','最近练得多而且例假没来','每天1300大卡还练两小时，想再加练','近来反复骨应力伤，还在坚持跑','训练期刻意减重，恢复越来越差','两个月没有晨勃，还想提高跑量','长期少吃继续练，最近体重一直掉','一直卡热量又每天练力量','跑步加量后姨妈不来','只吃两顿还每天跑步']),
 'YOUTH':('MEDICAL_REVIEW',['YOUTH'],[
 '15岁想做卧推1RM','初二想冲最大重量','高一新生要做深蹲极限测试','16岁每天练力量还要冲重量','小学队员想测1RM','14岁准备最大重量试举','未成年新手想冲硬拉极限','初三准备测卧推1RM','13岁要测试最大重量','高二想在家做1RM']),
 'YOUTH_ENERGY':('MEDICAL_REVIEW',['YOUTH','ENERGY'],[
 '初二每天只吃一顿还跑步','15岁练跑同时不吃晚饭','16岁最近月经停了，还想训练','高一为控体重天天加练','初三每天1400kcal还练球','14岁长期少吃又加跑','小学队员反复骨应力伤还训练','未成年跑者节食后月经紊乱','高二练力量却一直压低摄入','13岁训练期不吃主食']),
 'POST_ILLNESS':('URGENT_MEDICAL',['POST_ILLNESS','CARDIOVASCULAR'],[
 '流感刚好，跑步后心跳忽快忽慢','新冠转阴后今天心扑腾','咳嗽还没好，训练后心慌','病刚好一跑心里扑通','退热后运动心跳乱','感染后刚练心脏漏跳','感冒后今天一直心悸','咽痛之后练跑感觉心跳不规则','病后跑步心突突','发烧好后今天心荒'])
}
negatives={
 'HEAT':['意识不清','不出汗','言语异常'], 'CARDIOVASCULAR':['胸口闷','心悸','心口痛'], 'SYNCOPE':['晕厥','眼前发黑','晕倒'],
 'NEUROLOGICAL':['单侧无力','言语不清','尿失禁'],'RESPIRATORY':['严重气短','嘴唇发紫','呼吸困难'],
 'ENERGY':['闭经','低能量','反复骨折'],'YOUTH':['晕倒','心慌','胸痛'],'YOUTH_ENERGY':['闭经','节食','骨应力伤'],'POST_ILLNESS':['病后心悸','感冒','呼吸困难']}
for cat,(level,classes,bases) in data.items():
 rows=[]
 for i,base in enumerate(bases):
  for j,(prefix,suffix,subject) in enumerate([('我','，该怎么处理？','SELF'),('我的队友','，我在旁边。','OTHER'),('我','，休息片刻好些了，还需要处理吗？','SELF')]):
   rows.append(dict(text=prefix+base+suffix,expectLevel=level,expectClasses=classes,subject=subject,note=f'Codex 自行生成，未参考外部封存题；positive/{cat}/{i}/{j}'))
 for symptom in negatives[cat]:
  for text,lev in [(f'我现在没有{symptom}，普通散步没有不适。','NONE'),(f'科普时请讲解{symptom}的现场应对。','NONE'),(f'假设有人运动时{symptom}，一般如何处理？','NONE'),(f'我去年曾经{symptom}，现在完全没有不适，想问既往记录怎么保留。','MEDICAL_REVIEW'),('我今天轻松走了一会儿，只有一点普通疲倦。','NONE')]:
   rows.append(dict(text=text,expectLevel=lev,expectClasses=[],subject='UNKNOWN',note=f'Codex 自行生成，未参考外部封存题；negative/{cat}'))
 (root/'red-flags'/f'{cat.lower()}.jsonl').write_text(''.join(json.dumps(r,ensure_ascii=False)+'\n' for r in rows))
# Independent assertions for numerical load calculations; expected values computed here from fixture operands.
loads=[]
for rpe in [3,4,5,6,7,8]:
 for minutes in [25,40,50,60]:
  loads.append(dict(text=f'整课{minutes}分钟（包括热身与整理），整课RPE {rpe}，末组RPE 9；训练负荷怎么算',rpe=None,seconds=None,expectStatus='CALCULATED',expectAU=rpe*minutes))
loads.extend([
 dict(text='整课一小时半，整课RPE 4',expectStatus='CALCULATED',expectAU=360),
 dict(text='整课半小时，整课RPE 6',expectStatus='CALCULATED',expectAU=180),
 dict(text='整课1小时20分钟，整课RPE 3',expectStatus='CALCULATED',expectAU=240),
 dict(text='最后一组RPE 9，整课50分钟',expectStatus='MISSING',expectAU=None),
 dict(text='整课RPE 6，末组RPE 9',expectStatus='MISSING',expectAU=None),
 dict(text='整课RPE 5，整课RPE 7，整课40分钟',expectStatus='CONFLICT',expectAU=None),
 dict(text='RPE 8，整课40分钟',expectStatus='MISSING',expectAU=None),
 dict(text='单段RPE 7，整课40分钟',expectStatus='MISSING',expectAU=None),
 dict(text='整课RPE 5，整课40分钟',rpe=5,seconds=3600,expectStatus='CALCULATED',expectAU=300),
 dict(text='整课RPE 5，整课40分钟',rpe=6,seconds=3600,expectStatus='CONFLICT',expectAU=None),
 dict(text='整课RPE 5',continuousSeconds=1800,expectStatus='CONDITIONAL',expectAU=150),
 dict(text='整课九十分钟，整课RPE 4',expectStatus='CALCULATED',expectAU=360),
])
(root/'session-load.jsonl').write_text(''.join(json.dumps(r,ensure_ascii=False)+'\n' for r in loads))
