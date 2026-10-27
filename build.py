# Inlines src/logic.js and src/sign.js into src/app.html -> index.html, stamps a build id, writes version.json
import json, time
build = time.strftime("%Y%m%d%H%M%S")
s = open("src/app.html").read().replace("/*LOGIC*/", open("src/logic.js").read()).replace("/*SIGN*/", open("src/sign.js").read()).replace("/*BUILD*/", build)
open("index.html", "w").write(s)
json.dump({"build": build}, open("version.json", "w"))
print("build", build)
