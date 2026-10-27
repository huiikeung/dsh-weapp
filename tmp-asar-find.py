import json, sys

path = "/Applications/DeepSeek Harness.app/Contents/Resources/app.asar"
with open(path, "rb") as f:
    head = f.read(16)
    hdr_size = int.from_bytes(head[12:16], "little")
    hdr = json.loads(f.read(hdr_size).decode("utf-8"))
    files = []
    def walk(node, prefix):
        for name, entry in node.get("files", {}).items():
            p = prefix + "/" + name if prefix else name
            if "files" in entry:
                walk(entry, p)
            elif "size" in entry and "offset" in entry:
                files.append((p, int(entry["offset"]), int(entry["size"])))
    walk(hdr, "")

kw = sys.argv[1] if len(sys.argv) > 1 else "trajectory"
hits = [(p, s) for p, o, s in files if kw.lower() in p.lower()]
print("total files:", len(files), "| matches for", kw, ":", len(hits))
for p, s in hits[:60]:
    print(f"{s:>10}  {p}")
