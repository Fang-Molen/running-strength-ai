import urllib.request,os,sys,json
body=sys.stdin.buffer.read()
req=urllib.request.Request('https://api.deepseek.com/chat/completions',data=body,headers={'Authorization':'Bearer '+os.environ['DEEPSEEK_API_KEY'],'Content-Type':'application/json'})
try:
 with urllib.request.urlopen(req,timeout=25) as r: reply=json.load(r);[(c.get('message',{}).pop('reasoning_content',None)) for c in reply.get('choices',[])];print(json.dumps(reply,ensure_ascii=False))
except Exception as e:
 print(json.dumps({'transport_error':type(e).__name__,'http_status':getattr(e,'code',None)}));sys.exit(1)
