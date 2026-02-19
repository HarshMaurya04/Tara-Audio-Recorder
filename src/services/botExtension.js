export const getSenderFromBot = () => {
  return new Promise((resolve) => {
    const tryGet = () => {
      if (window.BotExtension?.getPayload) {
        window.BotExtension.getPayload((data) => {
          if (data) {
            resolve(data.value || data);
          } else {
            setTimeout(tryGet, 300);
          }
        });
      } else {
        setTimeout(tryGet, 300);
      }
    };

    tryGet();
  });
};


export const closeWebView = () => {
  if (window.BotExtension) {
    window.BotExtension.close();
  }
};
