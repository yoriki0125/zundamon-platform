(function () {
  const NAMESPACE = 'zundamonWidget';

  function ensureContainer(target) {
    if (typeof target === 'string') {
      const node = document.querySelector(target);
      if (!node) throw new Error('ZundamonWidget: container not found.');
      return node;
    }

    if (target instanceof HTMLElement) return target;
    throw new Error('ZundamonWidget: invalid container.');
  }

  function createIframe(baseUrl, mode) {
    const iframe = document.createElement('iframe');
    iframe.src = baseUrl.replace(/\/$/, '') + '/widget?mode=' + encodeURIComponent(mode || 'embedded');
    iframe.allow = 'autoplay';
    iframe.setAttribute('title', 'Zundamon Widget');
    iframe.style.width = '100%';
    iframe.style.border = '0';
    iframe.style.background = 'transparent';
    iframe.style.display = 'block';
    iframe.style.overflow = 'hidden';
    iframe.style.transition = 'height 0.4s cubic-bezier(0.4, 0, 0.2, 1)';
    iframe.style.height = mode === 'fullscreen' ? '100%' : '52px';
    return iframe;
  }

  function post(iframe, type, payload) {
    iframe.contentWindow && iframe.contentWindow.postMessage({ namespace: NAMESPACE, type: type, payload: payload }, '*');
  }

  function normalizeConfig(config) {
    return Object.assign(
      {
        baseUrl: window.location.origin,
        mode: 'embedded',
        autoResize: true,
        minHeight: 52,
        maxHeight: 960,
        floatingWidth: 420,
        floatingHeight: 760,
        zIndex: 9999,
      },
      config || {}
    );
  }

  function init(config) {
    const options = normalizeConfig(config);
    const container = options.mode === 'floating' ? document.body : ensureContainer(options.container);
    const iframe = createIframe(options.baseUrl, options.mode);
    const wrapper = document.createElement('div');

    let isOpen = options.mode !== 'floating';
    let launcher = null;

    if (options.mode === 'floating') {
      wrapper.style.position = 'fixed';
      wrapper.style.right = '24px';
      wrapper.style.bottom = '86px';
      wrapper.style.width = options.floatingWidth + 'px';
      wrapper.style.maxWidth = 'calc(100vw - 24px)';
      wrapper.style.height = options.floatingHeight + 'px';
      wrapper.style.maxHeight = 'calc(100vh - 120px)';
      wrapper.style.borderRadius = '24px';
      wrapper.style.boxShadow = '0 20px 60px rgba(16,35,29,0.22)';
      wrapper.style.overflow = 'hidden';
      wrapper.style.background = '#ffffff';
      wrapper.style.display = 'none';
      wrapper.style.zIndex = String(options.zIndex);

      launcher = document.createElement('button');
      launcher.type = 'button';
      launcher.textContent = options.launcherLabel || 'ずんだ';
      launcher.style.position = 'fixed';
      launcher.style.right = '24px';
      launcher.style.bottom = '24px';
      launcher.style.width = '56px';
      launcher.style.height = '56px';
      launcher.style.borderRadius = '9999px';
      launcher.style.border = '0';
      launcher.style.cursor = 'pointer';
      launcher.style.fontWeight = '700';
      launcher.style.color = '#ffffff';
      launcher.style.background = (options.theme && options.theme.primaryColor) || '#14b8a6';
      launcher.style.boxShadow = '0 16px 32px rgba(20,184,166,0.28)';
      launcher.style.zIndex = String(options.zIndex);
      launcher.addEventListener('click', function () {
        if (isOpen) {
          api.close();
        } else {
          api.open();
        }
      });
      container.appendChild(launcher);
    } else if (options.mode === 'fullscreen') {
      wrapper.style.position = 'fixed';
      wrapper.style.inset = '0';
      wrapper.style.zIndex = String(options.zIndex);
      wrapper.style.background = '#ffffff';
    }

    if (options.mode === 'embedded') {
      wrapper.style.width = '100%';
      wrapper.style.display = 'block';
    }

    wrapper.appendChild(iframe);
    container.appendChild(wrapper);

    function sendInit() {
      post(iframe, 'zundamon:init', {
        mode: options.mode,
        title: options.title,
        subtitle: options.subtitle,
        characterName: options.characterName,
        tenantId: options.tenantId,
        userId: options.userId,
        token: options.token,
        aiEndpoint: options.aiEndpoint,
        context: options.context,
        locale: options.locale,
        defaultEmotion: options.defaultEmotion,
        suggestedPrompts: options.suggestedPrompts,
        theme: options.theme,
        parentOrigin: window.location.origin,
      });
    }

    function handleMessage(event) {
      if (event.source !== iframe.contentWindow) return;
      const data = event.data;
      if (!data || data.namespace !== NAMESPACE) return;

      if (data.type === 'zundamon:ready') {
        sendInit();
        typeof options.onReady === 'function' && options.onReady(data.payload);
      }

      if (data.type === 'zundamon:resize' && options.autoResize !== false) {
        const height = Math.max(options.minHeight, Math.min(options.maxHeight, Number(data.payload && data.payload.height) || options.minHeight));
        if (options.mode === 'embedded') {
          iframe.style.height = height + 'px';
        }
      }

      if (data.type === 'zundamon:messageSent' && typeof options.onMessageSent === 'function') {
        options.onMessageSent(data.payload);
      }

      if (data.type === 'zundamon:answerShown' && typeof options.onAnswerShown === 'function') {
        options.onAnswerShown(data.payload);
      }

      if (data.type === 'zundamon:error' && typeof options.onError === 'function') {
        options.onError(data.payload);
      }
    }

    window.addEventListener('message', handleMessage);
    iframe.addEventListener('load', sendInit);

    const api = {
      open: function () {
        if (options.mode !== 'floating') return;
        wrapper.style.display = 'block';
        isOpen = true;
        typeof options.onOpen === 'function' && options.onOpen();
      },
      close: function () {
        if (options.mode !== 'floating') return;
        wrapper.style.display = 'none';
        isOpen = false;
        typeof options.onClose === 'function' && options.onClose();
      },
      toggle: function () {
        isOpen ? api.close() : api.open();
      },
      sendMessage: function (text, emotion) {
        post(iframe, 'zundamon:sendMessage', { text: text, emotion: emotion });
      },
      setContext: function (context) {
        post(iframe, 'zundamon:setContext', { context: context });
      },
      refreshToken: function (token) {
        post(iframe, 'zundamon:refreshToken', { token: token });
      },
      destroy: function () {
        window.removeEventListener('message', handleMessage);
        iframe.removeEventListener('load', sendInit);
        wrapper.remove();
        launcher && launcher.remove();
      },
      iframe: iframe,
      wrapper: wrapper,
    };

    return api;
  }

  window.ZundamonWidget = { init: init };
})();
