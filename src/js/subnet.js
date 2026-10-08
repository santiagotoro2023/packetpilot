// Subnetting trainer: random questions, answers and a worked explanation. No DOM.
import { ipToInt, intToIp, maskOf } from './net.js';

const rnd = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
const pick = a => a[Math.floor(Math.random() * a.length)];
export const LEVELS = { easy: 'Easy: /8, /16, /24', medium: 'Medium: last octet', hard: 'Hard: any prefix' };

function prefixFor(level) {
  if (level === 'easy') return pick([8, 16, 24]);
  if (level === 'medium') return rnd(24, 30);
  return rnd(9, 30);
}
function randomIp() {
  const first = pick([10, 172, 192]);
  const second = first === 172 ? rnd(16, 31) : first === 192 ? 168 : rnd(0, 255);
  return intToIp(((first << 24) | (second << 16) | (rnd(0, 255) << 8) | rnd(1, 254)) >>> 0);
}
export const maskStr = len => intToIp(maskOf(len));
export function info(ip, len) {
  const n = ipToInt(ip), m = maskOf(len);
  const net = (n & m) >>> 0, bc = (net | (~m >>> 0)) >>> 0;
  const hosts = len >= 31 ? (len === 31 ? 2 : 1) : 2 ** (32 - len) - 2;
  return { net: intToIp(net), bc: intToIp(bc), first: intToIp(len >= 31 ? net : net + 1), last: intToIp(len >= 31 ? bc : bc - 1), hosts, mask: maskStr(len) };
}
/** The octet where the prefix ends, its block size and the binary picture */
export function explainOctet(ip, len) {
  const o = Math.min(3, Math.floor(len / 8));
  const bits = len - o * 8;
  const val = Number(ip.split('.')[o]);
  const block = 2 ** (8 - bits);
  const start = Math.floor(val / block) * block;
  return { octet: o + 1, bits, block, val, start, end: start + block - 1, maskOctet: 256 - block, binary: val.toString(2).padStart(8, '0') };
}

export const MODES = {
  range: {
    title: 'Network and broadcast', text: 'Find the network, the broadcast address, the usable host range and the number of hosts.',
    make(level) { const len = prefixFor(level); const ip = randomIp(); const i = info(ip, len); return { q: `${ip}/${len}`, ip, len, fields: [
      ['Network address', i.net], ['Broadcast address', i.bc], ['First host', i.first], ['Last host', i.last], ['Usable hosts', String(i.hosts)]] }; }
  },
  mask: {
    title: 'Prefix and mask', text: 'Convert between the prefix length and the dotted subnet mask.',
    make(level) { const len = prefixFor(level); return Math.random() < .5
      ? { q: `/${len} as a subnet mask`, len, fields: [['Subnet mask', maskStr(len)]] }
      : { q: `${maskStr(len)} as a prefix`, len, fields: [['Prefix length', String(len), v => String(v).replace(/^\//, '')]] }; }
  },
  size: {
    title: 'Size a subnet', text: 'Find the smallest subnet that fits the number of hosts.',
    make(level) {
      const maxBits = level === 'easy' ? 8 : level === 'medium' ? 8 : 14;
      const bits = rnd(level === 'easy' ? 2 : 2, maxBits);
      const hosts = rnd(2 ** (bits - 1) - 1, 2 ** bits - 2);
      const len = 32 - bits;
      return { q: `${hosts} hosts`, len, hosts, fields: [['Smallest prefix', String(len), v => String(v).replace(/^\//, '')], ['Usable hosts in it', String(2 ** bits - 2)]] };
    }
  },
  same: {
    title: 'Same subnet?', text: 'Decide whether two hosts are in the same subnet and can talk without a router.',
    make(level) {
      const len = prefixFor(level);
      // Both hosts must be real hosts: never the network or broadcast address of the subnet
      let ip; do ip = randomIp(); while (ip === info(ip, len).net || ip === info(ip, len).bc);
      const i = info(ip, len);
      const base = ipToInt(i.net), size = 2 ** (32 - len);
      const same = Math.random() < .5;
      const step = base + 2 * size <= 0xffffffff ? size : -size;
      const other = intToIp((base + (same ? 0 : step) + rnd(1, Math.max(1, size - 2))) >>> 0);
      return { q: `${ip}/${len} and ${other}/${len}`, ip, len, other, fields: [['Same subnet? (yes or no)', same ? 'yes' : 'no', v => String(v).trim().toLowerCase().replace(/^y$/, 'yes').replace(/^n$/, 'no')]] };
    }
  },
  split: {
    title: 'Split a network', text: 'Divide a network into equal subnets and find a specific one.',
    make(level) {
      const len = level === 'easy' ? 24 : level === 'medium' ? pick([24, 25, 26]) : rnd(16, 26);
      const more = level === 'easy' ? pick([1, 2]) : rnd(1, Math.min(4, 30 - len));
      const ip = randomIp(); const net = info(ip, len).net;
      const count = 2 ** more, nth = rnd(2, count), newLen = len + more;
      const sub = intToIp((ipToInt(net) + (nth - 1) * 2 ** (32 - newLen)) >>> 0);
      const si = info(sub, newLen);
      return { q: `${net}/${len} into ${count} equal subnets: the ${ord(nth)} one`, len: newLen, ip: sub, fields: [['Prefix of the subnets', String(newLen), v => String(v).replace(/^\//, '')], ['Network address', si.net], ['Broadcast address', si.bc]] };
    }
  }
};
const ord = n => n + (['th', 'st', 'nd', 'rd'][(n % 100 > 10 && n % 100 < 14) ? 0 : Math.min(n % 10, 4) === 4 ? 0 : n % 10] || 'th');

/** Explanation in HTML for a question */
export function explain(mode, q) {
  if (mode === 'mask' || mode === 'size') {
    const bits = 32 - q.len;
    const e = q.len % 8 === 0 && q.len ? `The mask ends exactly at an octet boundary.` : `${q.len} ones: ${Math.floor(q.len / 8)} full octets of 255, then ${q.len % 8} more bits = ${256 - 2 ** (8 - q.len % 8)}.`;
    return mode === 'mask' ? `<p>/${q.len} means ${q.len} ones followed by ${bits} zeros. ${e} So /${q.len} = <code>${maskStr(q.len)}</code>.</p>`
      : `<p>With ${bits} host bits there are 2<sup>${bits}</sup> − 2 = ${2 ** bits - 2} usable addresses (network and broadcast are reserved). ${bits === 2 ? 'One host bit (/31) gives only 2 addresses, which on a normal LAN would both be reserved (only point-to-point links may use both, RFC 3021).' : `${bits - 1} host bits would only give ${2 ** (bits - 1) - 2}, too few for ${q.hosts}.`} So the prefix is 32 − ${bits} = <b>/${q.len}</b>.</p>`;
  }
  const x = explainOctet(q.ip, q.len), i = info(q.ip, q.len);
  if (q.len % 8 === 0) return `<p>/${q.len} ends at an octet boundary: the first ${q.len / 8} octets are the network, the rest are host bits. Network <code>${i.net}</code> (all host bits 0), broadcast <code>${i.bc}</code> (all host bits 1).</p>
<p>The hosts are everything in between: first host = network + 1 = <code>${i.first}</code>, last host = broadcast − 1 = <code>${i.last}</code>. ${i.hosts.toLocaleString('en')} usable.</p>`;
  const mark = x.binary.slice(0, x.bits) + '|' + x.binary.slice(x.bits);
  let s = `<p>The prefix /${q.len} ends in octet ${x.octet} after ${x.bits} bit${x.bits === 1 ? '' : 's'}. Mask in that octet: 256 − ${x.block} = ${x.maskOctet}, so the subnets there come in blocks of <b>${x.block}</b>.</p>
<p>Octet ${x.octet} of <code>${q.ip}</code> is ${x.val} = <code>${mark}</code> in binary (network bits | host bits). ${x.val} lies in the block <b>${x.start} to ${x.end}</b>.</p>
<p><b>Network</b> = start of the block, all host bits 0: <code>${i.net}</code>. <b>Broadcast</b> = end of the block, all host bits 1: <code>${i.bc}</code>.</p>
<p><b>First host</b> = network + 1 = <code>${i.first}</code>, <b>last host</b> = broadcast − 1 = <code>${i.last}</code>. ${x.octet === 4 && (x.start > 0 || x.end < 255) ? `Not ${[x.start > 0 && '.1', x.end < 255 && '.254'].filter(Boolean).join(' or ')}: ${x.start > 0 && x.end < 255 ? 'those belong to other blocks' : 'that belongs to another block'}, this block only runs from ${x.start} to ${x.end}.` : ''} 2<sup>${32 - q.len}</sup> − 2 = ${i.hosts.toLocaleString('en')} usable.</p>`;
  if (mode === 'same') s += `<p>${q.other} ${info(q.other, q.len).net === i.net ? 'lies in the same block, so: <b>yes</b>' : `belongs to the network ${info(q.other, q.len).net}, so: <b>no</b>, the hosts need a router`}.</p>`;
  return s;
}

/** Compare an answer with the expected value of a field */
export function checkField(field, value) {
  const [, expected, norm] = field;
  const n = norm || (v => String(v).trim().toLowerCase());
  return n(value) === n(expected);
}
