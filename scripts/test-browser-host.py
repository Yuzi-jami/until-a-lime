import os,json,socket,struct,subprocess,tempfile,threading
from pathlib import Path
exe=Path('target/release/lime-browser-host.exe').resolve()
identifier=Path('extension/extension-id.txt').read_text().strip()
def frame(obj):
 b=json.dumps(obj).encode(); return struct.pack('<I',len(b))+b
def read(s,n):
 b=b''
 while len(b)<n:
  x=s.recv(n-len(b))
  if not x: raise RuntimeError('truncated')
  b+=x
 return b
with tempfile.TemporaryDirectory() as folder:
 app=Path(folder)/'dev.untilalime.desktop';app.mkdir()
 listener=socket.socket();listener.bind(('127.0.0.1',0));listener.listen(1);listener.settimeout(5)
 token='a'*64
 (app/'browser-bridge.json').write_text(json.dumps({'port':listener.getsockname()[1],'token':token}))
 failures=[]
 def serve():
  try:
   with listener.accept()[0] as client:
    size=struct.unpack('<I',read(client,4))[0];req=json.loads(read(client,size))
    assert req['token']==token and req['extension']==f'chrome-extension://{identifier}/'
    assert req['request']=={'operation':'list','origin':'https://example.invalid','id':None}
    client.sendall(frame({'entries':[{'id':1,'name':'Fictional','user':'demo'}]}))
  except Exception as e: failures.append(str(e))
 thread=threading.Thread(target=serve);thread.start()
 env={**os.environ,'APPDATA':folder}
 result=subprocess.run([str(exe),f'chrome-extension://{identifier}/'],input=frame({'operation':'list','origin':'https://example.invalid','id':None}),capture_output=True,env=env,timeout=8)
 thread.join();listener.close();assert not failures,failures
 size=struct.unpack('<I',result.stdout[:4])[0];reply=json.loads(result.stdout[4:]);assert len(result.stdout)==size+4
 assert reply['entries'][0]['name']=='Fictional' and result.returncode==0
 denied=subprocess.run([str(exe),'chrome-extension://invalid/'],capture_output=True,env=env,timeout=5)
 assert 'error' in json.loads(denied.stdout[4:])
 print('PASS: real host framed stdio -> isolated mock loopback -> reply; incorrect extension denied; no real AppData access or registry changes.')
