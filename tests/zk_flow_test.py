import json,base64,socket,subprocess,sys,time,uuid,re
from playwright.sync_api import sync_playwright
DOCS=__import__("os").path.join(__import__("os").path.dirname(__import__("os").path.abspath(__file__)),"..","docs")
s=socket.socket(); s.bind(("127.0.0.1",0)); port=s.getsockname()[1]; s.close()
srv=subprocess.Popen([sys.executable,"-m","http.server",str(port),"--bind","127.0.0.1"],cwd=DOCS,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL); time.sleep(1)
CORS={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"*","Access-Control-Allow-Methods":"*"}
b64=lambda d: base64.urlsafe_b64encode(json.dumps(d).encode()).decode().rstrip("=")
DB={"users":{}, "keys":{}, "probe":[]}     # what the "server" holds
def jwt(uid): return b64({"alg":"none"})+"."+b64({"sub":uid,"role":"authenticated"})+".sig"
def uid_of(tok):
    p=tok.split(".")[1]; p+="="*(-len(p)%4); return json.loads(base64.urlsafe_b64decode(p))["sub"]
raw_requests=[]
def handler(route):
    r=route.request; u=r.url.replace("https://ggprfdetivzekjxlpvyq.supabase.co",""); m=r.method
    if m=="OPTIONS": return route.fulfill(status=204,headers=CORS)
    body=json.loads(r.post_data) if r.post_data else None
    raw_requests.append((m,u,r.post_data or ""))
    auth=(r.headers.get("authorization") or "").replace("Bearer ","")
    me=uid_of(auth) if auth.count(".")==2 else None
    def ok(d,status=200): route.fulfill(status=status,headers=CORS,content_type="application/json",body=json.dumps(d))
    if u.startswith("/auth/v1/signup"):
        if body["email"] in DB["users"]: return ok({"msg":"User already registered"},422)
        uid=str(uuid.uuid4()); DB["users"][body["email"]]={"id":uid,"pw":body["password"]}; return ok({"access_token":jwt(uid),"user":{"id":uid}})
    if u.startswith("/auth/v1/token"):
        us=DB["users"].get(body["email"])
        return ok({"access_token":jwt(us["id"])}) if us and us["pw"]==body["password"] else ok({"error":"invalid_grant"},400)
    if u.startswith("/auth/v1/user") and m=="PUT":
        for us in DB["users"].values():
            if us["id"]==me: us["pw"]=body["password"]; return ok({"id":me})
        return ok({},401)
    if u.startswith("/auth/v1/recover") or u.startswith("/auth/v1/logout"): return ok({})
    if u.startswith("/rest/v1/rpc/zk_login_params"):
        for e,us in DB["users"].items():
            if e.lower()==body["p_email"].lower() and us["id"] in DB["keys"]: k=DB["keys"][us["id"]]; return ok({"pw_salt":k["pw_salt"],"kdf":k["kdf"]})
        return ok({"pw_salt":"RkFLRVNBTFRGQUtFU0FMVA==","kdf":{"iterations":600000}})
    if not me: return ok({"message":"JWT required"},401)
    if u.startswith("/rest/v1/user_keys"):
        if m=="POST": DB["keys"][me]=body; return ok({},201)
        if m=="PATCH": DB["keys"][me].update(body); return ok({},204)
        return ok([DB["keys"][me]] if me in DB["keys"] else [])
    if u.startswith("/rest/v1/zk_probe"):
        if m=="POST": DB["probe"].append(dict(body,user_id=me,created_at=str(time.time()))); return ok({},201)
        return ok([x for x in DB["probe"] if x["user_id"]==me][::-1])
    ok({"message":"unhandled "+u},404)
res=[]
def check(name,cond): res.append(cond); print(("  ✓ " if cond else "  ✗ ")+name)
EMAIL="demo-zk@example.com"; PW="correct horse battery staple"; PW2="brand new password 456"; NOTE="SMGBl 12.5 units GBP 120 secret holding"
with sync_playwright() as p:
    b=p.chromium.launch(executable_path="/usr/bin/google-chrome",args=["--no-sandbox"])
    ctx=b.new_context(); ctx.route("https://ggprfdetivzekjxlpvyq.supabase.co/**",handler)
    pg=ctx.new_page(); errs=[]; pg.on("pageerror",lambda e:errs.append(str(e)))
    def goto(): pg.goto(f"http://127.0.0.1:{port}/zk/index.html",wait_until="networkidle")
    def login(pw,wait=3000):
        pg.fill("#li-email",EMAIL); pg.fill("#li-pw",pw); pg.click("#btn-login"); pg.wait_for_timeout(wait)
    goto()
    pg.fill("#su-email",EMAIL); pg.fill("#su-pw",PW); pg.fill("#su-pw2",PW); pg.click("#btn-signup"); pg.wait_for_selector("#v-recovery:not(.hide)",timeout=20000)
    REC=pg.inner_text("#rec-key"); check("recovery key shown once after sign-up",bool(re.match(r"^([A-Z2-7]{4}-){7}[A-Z2-7]{4}$",REC)))
    check("Continue disabled until 'I saved it' ticked",pg.is_disabled("#btn-rec-continue"))
    pg.check("#rec-ok"); pg.click("#btn-rec-continue"); pg.wait_for_selector("#v-app:not(.hide)")
    pg.fill("#note-in",NOTE); pg.click("#btn-note"); pg.wait_for_timeout(800)
    check("note readable in the browser",NOTE in pg.inner_text("#notes-plain"))
    check("raw view shows only ciphertext",NOTE.split()[0] not in pg.inner_text("#notes-raw") and "ct" in pg.inner_text("#notes-raw"))
    pg.click("#btn-logout"); pg.wait_for_selector("#v-auth:not(.hide)")
    login("wrong password!!"); check("wrong password rejected",("Invalid" in pg.inner_text("#li-err")))
    login(PW); pg.wait_for_selector("#v-app:not(.hide)",timeout=20000); check("log in again, note decrypts",NOTE in pg.inner_text("#notes-plain"))
    pg.reload(wait_until="networkidle"); pg.wait_for_timeout(800); check("page reload in same tab stays unlocked",not pg.is_visible("#v-auth") and NOTE in pg.inner_text("#notes-plain"))
    pg.fill("#cp-pw",PW2); pg.click("#btn-cp"); pg.wait_for_timeout(3500); check("change password succeeds",("changed" in pg.inner_text("#cp-msg")))
    pg.click("#btn-logout"); pg.wait_for_selector("#v-auth:not(.hide)")
    login(PW); check("old password no longer works",("Invalid" in pg.inner_text("#li-err")))
    login(PW2); pg.wait_for_selector("#v-app:not(.hide)",timeout=20000); check("new password works and old note still decrypts",NOTE in pg.inner_text("#notes-plain"))
    pg.click("#btn-logout"); pg.wait_for_selector("#v-auth:not(.hide)")
    # forgot password: simulate the emailed link (recovery session)
    uid=DB["users"][EMAIL]["id"]; PW3="reset by recovery key 789"
    pg.goto("about:blank"); pg.goto(f"http://127.0.0.1:{port}/zk/index.html#access_token={jwt(uid)}&type=recovery",wait_until="networkidle"); pg.wait_for_selector("#v-reset:not(.hide)")
    pg.fill("#rs-key","AAAA-AAAA-AAAA-AAAA-AAAA-AAAA-AAAA-AAAA"); pg.fill("#rs-pw",PW3); pg.click("#btn-reset"); pg.wait_for_timeout(3000)
    check("wrong recovery key rejected",("does not match" in pg.inner_text("#rs-err")))
    pg.fill("#rs-key",REC.lower()); pg.click("#btn-reset"); pg.wait_for_selector("#v-auth:not(.hide)",timeout=20000)
    login(PW3); pg.wait_for_selector("#v-app:not(.hide)",timeout=20000); check("after reset: new password works and ALL old data still decrypts",NOTE in pg.inner_text("#notes-plain"))
    # what the server ever saw
    wire="\n".join(f"{m} {u} {body}" for m,u,body in raw_requests); dump=json.dumps(DB)
    for label,secret in (("password 1",PW),("password 2",PW2),("password 3",PW3),("recovery key",REC),("note text","12.5 units"),("note ticker","SMGBl")):
        check(f"server never received/stored: {label}",secret not in wire and secret not in dump)
    check("no page errors",not errs)
    b.close()
srv.terminate(); print(f"\n{sum(res)} passed · {len(res)-sum(res)} failed", errs or "")
sys.exit(0 if all(res) else 1)
