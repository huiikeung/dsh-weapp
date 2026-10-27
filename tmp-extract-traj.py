import json
path = "/Applications/DeepSeek Harness.app/Contents/Resources/app.asar"
fd = open(path, "rb")
head = fd.read(16)
hdrSize = int.from_bytes(head[12:16], "little")
hdr = json.loads(fd.read(hdrSize).decode("utf-8"))
dataStart = 16 + hdrSize
files = []
def walk(node, prefix):
    for name, entry in node.get("files", {}).items():
        p = prefix + "/" + name if prefix else name
        if "files" in entry: walk(entry, p)
        elif "size" in entry and "offset" in entry: files.append((p, int(entry["offset"]), int(entry["size"])))
walk(hdr, "")
targets = {
  "dsh/node_modules/@deepseek-ai/dsh-client-ui-trajectory/lib/client.js": "/tmp/dsh-traj-client.js",
  "dsh/node_modules/@deepseek-ai/dsh-client-ui-trajectory/README.zh.md": "/tmp/dsh-traj-readme-zh.md",
  "dsh/node_modules/@deepseek-ai/dsh-client-ui-trajectory/locale/zh.json": "/tmp/dsh-traj-locale-zh.json",
}
for p, off, sz in files:
    if p in targets:
        fd.seek(dataStart + off)
        open(targets[p], "wb").write(fd.read(sz))
        print("extracted", p, sz)
fd.close()
