/**
 * sw.js - Service Worker
 * 为 AI 写剧本提供离线缓存和快速加载支持
 */

const CACHE_NAME = 'ai-script-v1';

// ===== 安装阶段：动态缓存关键资源 =====
self.addEventListener('install', (event) => {
  // 不等待，直接激活
  self.skipWaiting();
});

// ===== 激活阶段：清理旧缓存，接管页面 =====
self.addEventListener('activate', (event) => {
  event.waitUntil(
    Promise.all([
      // 清理旧版本缓存
      caches.keys().then((cacheNames) => {
        return Promise.all(
          cacheNames.map((cacheName) => {
            if (cacheName !== CACHE_NAME) {
              return caches.delete(cacheName);
            }
          })
        );
      }),
      // 立即接管所有客户端
      self.clients.claim(),
    ])
  );
});

// ===== 请求拦截：Cache-First 策略 =====
self.addEventListener('fetch', (event) => {
  // 只处理 GET 请求
  if (event.request.method !== 'GET') return;

  // 只处理同源请求（不拦截外部 API 调用）
  const url = new URL(event.request.url);
  if (url.hostname !== self.location.hostname) {
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      // 有缓存 -> 直接返回（快速加载 + 离线可用）
      if (cachedResponse) {
        return cachedResponse;
      }

      // 无缓存 -> 发起网络请求，成功后缓存
      return fetch(event.request).then((response) => {
        // 只缓存有效的同源响应
        if (!response || response.status !== 200 || response.type !== 'basic') {
          return response;
        }

        const responseToCache = response.clone();
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(event.request, responseToCache);
        });

        return response;
      }).catch(() => {
        // 网络不可用时，返回离线占位信息
        return new Response('网络不可用，请检查连接', {
          status: 200,
          statusText: 'OK',
          headers: new Headers({ 'Content-Type': 'text/plain; charset=utf-8' }),
        });
      });
    })
  );
});
