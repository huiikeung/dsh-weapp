import json
path = "/Applications/DeepSeek Harness.app/Contents/Resources/app.asar"
fd = open(path, "rb")
head = fd.read(16)
hdrSize = int.from_bytes(head[12:16], "little")
hdr = json.loads(fd.read(hdrSize).decode("utf-8"))
dataStart = 16 + hdrSize

def findFile(files, name):
    for p, off, sz in files:
        if p == name: return (off, sz)
    return None

def walk(node, prefix, files):
    for name, entry in node.get("files", {}).items():
        p = prefix + "/" + name if prefix else name
        if "files" in entry:
            walk(entry, p, files)
        elif "size" in entry and "offset" in entry:
            files.append((p, int(entry["offset"]), int(entry["size"])))

files = []
walk(hdr, "", files)

# Read README.md for trajectory module
off, sz = findFile(files, "dsh/node_modules/@deepseek-ai/dsh-client-ui-trajectory/README.md")
if off and sz:
    fd.seek(dataStart + off)
    print(fd.read(sz).decode("utf-8")[:8000])
else:
    print("NOT FOUND")
fd.close()
