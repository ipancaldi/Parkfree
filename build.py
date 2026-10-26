# Inlines src/logic.js into src/app.html -> index.html
s=open('src/app.html').read().replace('/*LOGIC*/',open('src/logic.js').read())
open('index.html','w').write(s)
