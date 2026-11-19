# Upgrade an existing plaintext account to a private one against a simulated server. Run: python3 tests/zk_migrate_test.py
import json,base64,socket,subprocess,sys,time,uuid,re,os,random
from urllib.parse import urlparse,parse_qs
from playwright.sync_api import sync_playwright
DOCS=os.path.join(os.path.dirname(os.path.abspath(__file__)),"..","docs")
s=socket.socket(); s.bind(("127.0.0.1",0)); port=s.getsockname()[1]; s.close()
srv=subprocess.Popen([sys.executable,"-m","http.server",str(port),"--bind","127.0.0.1"],cwd=DOCS,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL); time.sleep(1)
CORS={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"*","Access-Control-Allow-Methods":"*"}
b64=lambda d: base64.urlsafe_b64encode(json.dumps(d).encode()).decode().rstrip("=")
jwt=lambda uid: b64({"alg":"none"})+"."+b64({"sub":uid,"role":"authenticated"})+".sig"
def uid_of(t):
    p=t.split(".")[1]; p+="="*(-len(p)%4); return json.loads(base64.urlsafe_b64decode(p))["sub"]
EMAIL="legacy@example.com"; OLD="old-plaintext-password"; NEW="brand new private password"
UID=str(uuid.uuid4()); OTHER=str(uuid.uuid4()); random.seed(1)
TICK=["SMGBl_EQ","QDVEd_EQ","VUSAa_EQ","NVDA_US_EQ","CS1l_EQ"]
PLAIN={"users":{EMAIL:{"id":UID,"pw":OLD}},"keys":{},"enc":[],
 "tables":{t:[] for t in ["positions","positions_archive","portfolio_snapshots","portfolio_snapshots_archive","t212_orders","t212_transactions","t212_dividends","dividends","realised_pnl","watchlist","watchlist_analysis","pie_history","profit_booking","profit_booking_summary","returns_summary","holding_decisions","strategy_recommendations","value_buy_scores","alerts","analyst_ratings"]}}
T=PLAIN["tables"]
for i in range(1,31): T["portfolio_snapshots"].append({"id":i,"user_id":UID,"created_at":f"2026-11-{i%28+1:02d}T05:00:00Z","total_value":1000+i})
for i in range(1,2501): T["positions"].append({"id":i,"user_id":UID,"snapshot_id":i%30+1,"ticker":random.choice(TICK),"ppl":round(random.uniform(-50,200),2),"gain_pct":round(random.uniform(-10,30),2)})   # >2 pages
for i in range(1,301): T["t212_orders"].append({"id":i,"user_id":UID,"ticker":random.choice(TICK),"qty":round(random.uniform(0.1,20),4),"price":round(random.uniform(10,500),2)})
T["returns_summary"].append({"user_id":UID,"details":{"twr_pct":9.1,"series":{"value":[1,2,3]}}})     # no id column
T["watchlist"]+= [{"id":1,"user_id":UID,"t212_ticker":"SECRET_EQ"}]
T["positions"].append({"id":9999,"user_id":OTHER,"snapshot_id":1,"ticker":"OTHERS_EQ","ppl":1})     # another tenant's row must never be touched
ORIG={k:[r for r in v if r["user_id"]==UID] for k,v in T.items()}
wire=[]
def handler(route):
    r=route.request; u=r.url.replace("https://ggprfdetivzekjxlpvyq.supabase.co",""); m=r.method
    if m=="OPTIONS": return route.fulfill(status=204,headers=CORS)
    body=json.loads(r.post_data) if r.post_data else None; wire.append(f"{m} {u} {r.post_data or ''}")
    auth=(r.headers.get("authorization") or "").replace("Bearer ",""); me=uid_of(auth) if auth.count(".")==2 else None
    def ok(d,st=200): route.fulfill(status=st,headers=CORS,content_type="application/json",body=json.dumps(d))
    pu=urlparse(u); q=parse_qs(pu.query); path=pu.path
    if path=="/auth/v1/token":
        us=PLAIN["users"].get(body["email"]); return ok({"access_token":jwt(us["id"])}) if us and us["pw"]==body["password"] else ok({"error":"invalid_grant"},400)
    if path=="/auth/v1/user" and m=="PUT":
        for us in PLAIN["users"].values():
            if us["id"]==me: us["pw"]=body["password"]; return ok({"id":me})
        return ok({},401)
    if path=="/rest/v1/rpc/zk_login_params":
        for e,us in PLAIN["users"].items():
            if e==body["p_email"] and us["id"] in PLAIN["keys"]: k=PLAIN["keys"][us["id"]]; return ok({"pw_salt":k["pw_salt"],"kdf":k["kdf"]})
        return ok({"pw_salt":"RkFLRVNBTFRGQUtFU0FMVA==","kdf":{"iterations":600000}})
    if not me: return ok({"message":"JWT required"},401)
    if path=="/rest/v1/user_keys":
        if m=="POST": PLAIN["keys"][me]=body; return ok({},201)
        return ok([PLAIN["keys"][me]] if me in PLAIN["keys"] else [])
    if path=="/rest/v1/enc_rows":
        if m=="POST": PLAIN["enc"]+= [dict(x,user_id=me) for x in body]; return ok({},201)
        if m=="DELETE": k=q["kind"][0].replace("eq.",""); PLAIN["enc"]=[x for x in PLAIN["enc"] if not(x["user_id"]==me and x["kind"]==k)]; return ok({},204)
        k=q["kind"][0].replace("eq.",""); rows=sorted([x for x in PLAIN["enc"] if x["user_id"]==me and x["kind"]==k],key=lambda x:x["id"])
        off=int(q.get("offset",["0"])[0]); lim=int(q.get("limit",["1000"])[0]); return ok([{"id":x["id"],"nonce":x["nonce"],"ct":x["ct"]} for x in rows[off:off+lim]])
    tm=re.match(r"/rest/v1/(\w+)$",path)
    if tm and tm.group(1) in T:
        t=tm.group(1)
        if m=="DELETE": T[t]=[x for x in T[t] if x["user_id"]!=me]; return ok({},204)
        rows=[x for x in T[t] if x["user_id"]==me]
        if "order" in q:
            if t=="returns_summary": return ok({"message":"column id does not exist"},400)
            rows=sorted(rows,key=lambda x:x["id"])
        off=int(q.get("offset",["0"])[0]); lim=int(q.get("limit",["1000"])[0]); return ok(rows[off:off+lim])
    ok({"message":"unhandled "+u},404)
res=[]
def check(n,c): res.append(c); print(("  ✓ " if c else "  ✗ ")+n)
with sync_playwright() as p:
    b=p.chromium.launch(executable_path="/usr/bin/google-chrome",args=["--no-sandbox"])
    ctx=b.new_context(); ctx.route("https://ggprfdetivzekjxlpvyq.supabase.co/**",handler)
    pg=ctx.new_page(); errs=[]; pg.on("pageerror",lambda e:errs.append(str(e)))
    pg.goto(f"http://127.0.0.1:{port}/zk/index.html",wait_until="networkidle"); pg.click("#btn-to-upgrade")
    pg.fill("#up-email",EMAIL); pg.fill("#up-old",OLD); pg.fill("#up-new",OLD); pg.fill("#up-new2",OLD); pg.click("#btn-upgrade"); pg.wait_for_timeout(500)
    check("new password equal to old is refused",("different" in pg.inner_text("#up-err")))
    pg.fill("#up-new",NEW); pg.fill("#up-new2",NEW); pg.click("#btn-upgrade"); pg.wait_for_selector("#v-recovery:not(.hide)",timeout=120000)
    log=pg.inner_text("#up-log")
    check("every table verified OK (no MISMATCH)","MISMATCH" not in log and "positions: 2500 → 2500 OK" in log and "t212_orders: 300 → 300 OK" in log and "returns_summary: 1 → 1 OK" in log)
    check("old password still works until the final step (rollback-safe)",PLAIN["users"][EMAIL]["pw"]==OLD)
    check("plaintext still present after encrypt+verify",len(T["positions"])==2501)
    check("another tenant's rows untouched and never encrypted by us",any(x["user_id"]==OTHER for x in T["positions"]) and not any(x["user_id"]==OTHER for x in PLAIN["enc"]))
    REC=pg.inner_text("#rec-key"); pg.check("#rec-ok"); pg.click("#btn-rec-continue"); pg.wait_for_selector("#v-app:not(.hide)",timeout=90000)
    check("password switched only after the recovery key was acknowledged",PLAIN["users"][EMAIL]["pw"]!=OLD)
    pg.click("#btn-summary"); pg.wait_for_timeout(5000); sm=json.loads(pg.inner_text("#summary-out"))
    check("summary: all encrypted rows decrypt",sm.get("positions")=="2500/2500" and sm.get("t212_orders")=="300/300" and sm.get("watchlist")=="1/1")
    enc_dump=json.dumps(PLAIN["enc"])
    check("encrypted store contains no tickers/amounts",not any(w in enc_dump for w in ("SMGBl_EQ","NVDA_US_EQ","SECRET_EQ","gain_pct","t212_ticker","snapshot_id")))
    pg.fill("#purge-confirm","nope"); pg.click("#btn-purge"); pg.wait_for_timeout(300); check("purge needs the word DELETE",len(T["positions"])==2501)
    pg.fill("#purge-confirm","DELETE"); pg.click("#btn-purge"); pg.wait_for_timeout(15000)
    check("plaintext deleted for this user only",not any(x["user_id"]==UID for t in T.values() for x in t) and any(x["user_id"]==OTHER for x in T["positions"]))
    pg.click("#btn-logout"); pg.wait_for_selector("#v-auth:not(.hide)")
    pg.fill("#li-email",EMAIL); pg.fill("#li-pw",NEW); pg.click("#btn-login"); pg.wait_for_selector("#v-app:not(.hide)",timeout=90000)
    pg.click("#btn-summary"); pg.wait_for_timeout(5000)
    check("after logout/login with the new password, all data still decrypts",json.loads(pg.inner_text("#summary-out")).get("positions")=="2500/2500")
    w="\n".join(wire)
    check("server never saw the new password or recovery key",NEW not in w and REC not in w and NEW not in json.dumps(PLAIN) and REC not in json.dumps(PLAIN))
    check("no page errors",not errs)
    b.close()
srv.terminate(); print(f"\n{sum(res)} passed · {len(res)-sum(res)} failed",errs or "")
sys.exit(0 if all(res) else 1)
