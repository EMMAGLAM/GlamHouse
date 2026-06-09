const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
const token = process.env.REPL_IDENTITY
  ? `repl ${process.env.REPL_IDENTITY}`
  : process.env.WEB_REPL_RENEWAL
    ? `depl ${process.env.WEB_REPL_RENEWAL}`
    : null;
if (!hostname || !token) {
  console.error("Missing Replit connector environment.");
  process.exit(1);
}
const protocol = hostname.startsWith("localhost") ? "http" : "https";
const endpoint = `${protocol}://${hostname}/api/v2/proxy/admin/api/2026-04/graphql.json`;
const fs = await import("node:fs");

const ids = ["10500330586404","10500337172772","10500338778404","10500494393636","10500511695140","10500513661220","10500309123364","10500333338916","10500504387876","10500354933028","10500375413028","10500404216100","10500533518628","10500381671716","10500537319716","10500544266532","10500508254500","10500398252324","10500508614948","10500329341220","10500391108900","10500394844452"];

async function admin(query, variables) {
  const r = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Replit-Token": token, "Connector-Name": "shopify-store" },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(60000),
  });
  const text = await r.text();
  let j;
  try { j = JSON.parse(text); } catch { throw new Error(`HTTP ${r.status} non-JSON: ${text.slice(0, 400)}`); }
  if (j.errors) throw new Error("GQL: " + JSON.stringify(j.errors));
  return j.data;
}

const STAGE = `mutation stage($input:[StagedUploadInput!]!){ stagedUploadsCreate(input:$input){ stagedTargets{ url resourceUrl parameters{ name value } } userErrors{ field message } } }`;
const CREATE_MEDIA = `mutation cm($productId:ID!,$media:[CreateMediaInput!]!){ productCreateMedia(productId:$productId, media:$media){ media{ id status } mediaUserErrors{ field message } } }`;
const REORDER = `mutation rm($id:ID!,$moves:[MoveInput!]!){ productReorderMedia(id:$id, moves:$moves){ job{ id } mediaUserErrors{ field message } } }`;

async function uploadOne(filePath) {
  const buf = fs.readFileSync(filePath);
  const filename = filePath.split("/").pop();
  const d = await admin(STAGE, { input: [{ filename, mimeType: "image/jpeg", resource: "IMAGE", httpMethod: "POST", fileSize: String(buf.length) }] });
  if (d.stagedUploadsCreate.userErrors.length) throw new Error(JSON.stringify(d.stagedUploadsCreate.userErrors));
  const t = d.stagedUploadsCreate.stagedTargets[0];
  const form = new FormData();
  for (const p of t.parameters) form.append(p.name, p.value);
  form.append("file", new Blob([buf], { type: "image/jpeg" }), filename);
  const up = await fetch(t.url, { method: "POST", body: form, signal: AbortSignal.timeout(60000) });
  if (!up.ok) throw new Error("upload failed " + up.status + " " + (await up.text()).slice(0, 300));
  return t.resourceUrl;
}

for (const id of ids) {
  const pid = `gid://shopify/Product/${id}`;
  const file = `/tmp/unify/${id}_cream.jpg`;
  const resourceUrl = await uploadOne(file);
  const cm = await admin(CREATE_MEDIA, { productId: pid, media: [{ originalSource: resourceUrl, mediaContentType: "IMAGE", alt: "EMMA GLAM" }] });
  if (cm.productCreateMedia.mediaUserErrors.length) throw new Error("createMedia " + JSON.stringify(cm.productCreateMedia.mediaUserErrors));
  const mediaId = cm.productCreateMedia.media[0].id;
  const rm = await admin(REORDER, { id: pid, moves: [{ id: mediaId, newPosition: "0" }] });
  if (rm.productReorderMedia.mediaUserErrors.length) throw new Error("reorder " + JSON.stringify(rm.productReorderMedia.mediaUserErrors));
  console.log("uploaded+featured", id, mediaId);
}
console.log("DONE");
