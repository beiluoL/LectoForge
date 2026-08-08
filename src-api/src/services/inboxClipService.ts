/**
 * 网页剪藏服务 —— 从 routes/inbox.ts 原样搬运，抓取逻辑一字未改。
 *
 * 只做「抓 HTML → 解码 → 抽元数据」，不碰数据库、不碰 Fastify 上下文。
 * 任何失败都优雅降级为 ok:false 的可用结构，绝不抛 500 阻断用户手动录入。
 */
import axios from 'axios';
import * as cheerio from 'cheerio';
import iconv from 'iconv-lite';

import type { ClipResult } from '../types/inbox';

/** 把相对图片地址补成绝对地址（favicon 常见 /favicon.ico 这类相对路径） */
function absolutize(image: string | null | undefined, base: string): string | null {
  if (!image) return null;
  try {
    return new URL(image, base).href;
  } catch {
    return image;
  }
}

/**
 * 真实抓取网页元数据：axios（伪装 UA + 10s 超时 + arraybuffer）→ iconv 解码（应对 GBK）
 * → cheerio 解析 og / title / description / 正文摘要。任何异常都优雅降级，绝不抛 500。
 */
export async function clipUrl(rawUrl: string, snippetLen = 120): Promise<ClipResult> {
  let targetUrl: URL;
  try {
    targetUrl = new URL(rawUrl);
  } catch {
    return { title: '无效的链接', description: '请检查网址格式是否正确', image: null, url: rawUrl, snippet: '', ok: false };
  }

  try {
    const resp = await axios({
      method: 'get',
      url: targetUrl.href,
      timeout: 10000,
      responseType: 'arraybuffer',
      maxContentLength: 5 * 1024 * 1024, // 5MB 上限，防超大页面撑爆内存
      decompress: true,
      // 允许自签名 / 重定向；只读元数据，安全影响可控
      maxRedirects: 5,
      validateStatus: (s) => s >= 200 && s < 400,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept-Language': 'zh-CN,zh;q=0.9',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      },
    });

    // 解码：优先 header charset，其次 <meta charset>，默认 utf-8
    const contentType = String(resp.headers['content-type'] || '');
    let encoding = (contentType.match(/charset=([^;]+)/i)?.[1] || '').toLowerCase().trim();
    const buf = Buffer.from(resp.data);
    if (!encoding) {
      const head = buf.slice(0, 1024).toString('latin1');
      encoding = (head.match(/charset=["']?([\w-]+)/i)?.[1] || 'utf-8').toLowerCase();
    }
    if (encoding === 'gb2312' || encoding === 'gbk' || encoding === 'gb18030') encoding = 'gbk';
    if (!iconv.encodingExists(encoding)) encoding = 'utf-8';
    const html = iconv.decode(buf, encoding);

    const $ = cheerio.load(html);
    const title =
      $('meta[property="og:title"]').attr('content')?.trim() ||
      $('title').first().text().trim() ||
      targetUrl.hostname;
    const description =
      $('meta[property="og:description"]').attr('content')?.trim() ||
      $('meta[name="description"]').attr('content')?.trim() ||
      '';
    const image = absolutize(
      $('meta[property="og:image"]').attr('content') ||
        $('link[rel="icon"]').attr('href') ||
        $('link[rel="shortcut icon"]').attr('href') ||
        null,
      targetUrl.href,
    );

    // 正文摘要：剔除干扰标签后取纯文本前 snippetLen 字（clip 默认 120，metadata 取 200）
    $('script, style, nav, footer, header, aside, iframe, noscript, svg').remove();
    const plainText = $('body').text().replace(/\s+/g, ' ').trim();
    const snippet = plainText.slice(0, snippetLen);

    return { title, description, image, url: targetUrl.href, snippet, ok: true };
  } catch (error: any) {
    // 兜底：任何失败都返回可用结构，让前端 UI 照常填充（标题回退为域名）
    let msg = '页面抓取失败，可稍后重试或手动填写';
    if (axios.isAxiosError(error)) {
      if (error.code === 'ECONNABORTED') msg = '请求超时，请稍后重试';
      else if (error.response?.status === 404) msg = '目标页面不存在 (404)';
      else if (error.response?.status) msg = `访问失败 (${error.response.status})`;
    }
    return { title: targetUrl.hostname, description: msg, image: null, url: targetUrl.href, snippet: '', ok: false };
  }
}
