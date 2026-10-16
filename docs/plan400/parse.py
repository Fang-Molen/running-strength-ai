import re,json,datetime
L=open('plan.txt').read().split('\n')
weeks=[];cur=None;cols=None;day=None
def flush():
    global day
    if day: cur['days'].append(day); day=None
for i,l in enumerate(L):
    m=re.match(r'^(W\d+)｜(.+?)｜(\S+)$',l.strip())
    if m:
        flush(); cur={'week':m[1],'title':m[2],'range':m[3],'principle':'','days':[]}; weeks.append(cur); continue
    if cur is None: continue
    if l.strip().startswith('本周原则'): cur['principle']=l.strip(); continue
    if l.strip().startswith('日期') and '力量与核心' in l:
        cols=(l.index('正式主课'),l.index('辅助激活'),l.index('力量与核心')); continue
    if re.match(r'^\s*(本周不能忽略|\d+ / 15|第\d+周|STRENGTH)',l) :
        flush()
        if 'STRENGTH' in l: cur=None
        continue
    if cols is None or not l.strip(): continue
    md=re.match(r'^\s*(\d{1,2})/(\d{1,2})\s',l)
    if md: flush(); day={'orig':f'2026-{int(md[1]):02d}-{int(md[2]):02d}','weekday':'','main':[],'aux':[],'strength':[]}
    if day is None: continue
    a,b,c=cols
    left=l[:a].strip(); mainp=l[a:b].rstrip(); auxp=l[b:c]; strp=l[c:]
    # tolerate drift: if char at boundary is non-space, extend
    def cut(s,e):
        return l[s:e]
    if left.startswith('周'): day['weekday']=left[:2]
    for k,v in (('main',l[a-2 if a>=2 else a:b]),('aux',auxp),('strength',strp)):
        v=v.strip()
        if v: day[k].append(v)
flush()
out=[]
for w in weeks:
    for d in w['days']:
        o=datetime.date.fromisoformat(d['orig']); n=o+datetime.timedelta(days=7)
        d['date']=n.isoformat(); d['week']=w['week']
        d['title']=d['main'][0] if d['main'] else ''
out_final={'orig':'2026-12-21','date':'2026-12-28','week':'TEST','weekday':'周一','title':'12月21日最终测试（顺延至12/28）','main':['标准400米跑道计时一次，记录200m通过时间、400m成绩、风/天气、RPE与身体感受；目标53.00—53.99秒，不保证达成。若短距离能力不足以支持目标节奏，不强行跑目标通过时间。'],'aux':[],'strength':[]}
json.dump({'name':'400米53秒多 完整专项训练体系 V4','shiftDays':7,'weeks':[{k:w[k] for k in ('week','title','range','principle')} for w in weeks],'final':out_final,'days':[d for w in weeks for d in w['days']]+[out_final]},open('plan.json','w'),ensure_ascii=False,indent=1)
print(len(weeks),sum(len(w['days']) for w in weeks))
