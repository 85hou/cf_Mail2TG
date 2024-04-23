export default {
  async email(event, env, ctx) {
    //console.log(JSON.stringify(event)); // 查看事件对象的完整结构
    
    const to = event.to; // 收件人
    const subject = event.headers.get('subject'); // 邮件主题
    const raw = event.raw;  //是一个ReadableStream对象, 参考：https://developers.cloudflare.com/email-routing/email-workers/runtime-api/#emailmessage-definition 

    // ReadableStream转String
    const rawEmail = await streamToArrayBuffer(raw); 
    const parsedEmail = Utf8ArrayToStr(rawEmail);
    const textBody = parsePlainTextFromMIME(parsedEmail);

    //console.log(`纯文本正文：${textBody}`); // 检查正文情况

    // 发送到TGbot
    const telegramMessage = `来自：${to}\n<b>主题：${subject}</b>\n————————————————————\n${textBody}`;
    await notifyTelegram(env.TG_TOKEN, env.TG_ID, telegramMessage, true);
  },
};

// 使用Telegram Bot API发送通知
async function notifyTelegram(token, chatId, message, isMute) {
  const apiUrl = `https://api.telegram.org/bot${token}/sendMessage`;
  try {
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        chat_id: chatId,
        'parse_mode': 'html',
        'disable_notification':isMute,
        text: message,
      }),
    });

    const responseData = await response.json();
    if (!response.ok) {
      console.error('Failed to send message to Telegram:', responseData);
    }
  } catch (error) {
    console.error('Error sending message to Telegram:', error);
  }
}

async function streamToArrayBuffer(stream) {
  const reader = stream.getReader();
  let chunks = []; // 用于存储读取到的chunks
  let receivedLength = 0; // 已接收数据的长度
  
  while(true) {
    const {done, value} = await reader.read(); // 读取一个chunk
    
    if (done) {
      break; // 如果读取完成，则退出循环
    }
    
    chunks.push(value); // 将读取到的chunk添加到数组中
    receivedLength += value.length; // 更新已接收数据的长度
  }
  
  // 合并chunks到一个新的ArrayBuffer中
  let combined = new Uint8Array(receivedLength); // 创建一个足够大的Uint8Array
  let position = 0;
  for(let chunk of chunks) {
    combined.set(chunk, position); // 复制chunk数据到combined中
    position += chunk.length;
  }
  
  return combined.buffer; // 返回ArrayBuffer
}

function Utf8ArrayToStr(arrayBuffer) {
  // 使用TextDecoder解码ArrayBuffer
  return new TextDecoder("utf-8").decode(new Uint8Array(arrayBuffer));
}


function decodeQuotedPrintable(input) {
  // 先将软换行标记'=\r\n'替换为空字符串，以便正确连接被拆分的行
  input = input.replace(/=\r\n/g, '');

  // 解码Quoted-Printable编码的每一个字符
  const output = input.replace(/=([a-fA-F0-9]{2})/g, (match, p1) =>
    String.fromCharCode(parseInt(p1, 16))
  );

  // 使用TextDecoder确保按UTF-8编码解释字符串
  const decoder = new TextDecoder("utf-8");
  const bytes = new Uint8Array(output.split('').map(char => char.charCodeAt(0)));
  return decoder.decode(bytes);
}

function parsePlainTextFromMIME(rawEmailData) {
  const boundaryMatch = rawEmailData.match(/boundary="([^"]+)"/);
  if (!boundaryMatch) {
    throw new Error("Boundary not found");
  }
  const boundary = boundaryMatch[1];
  const parts = rawEmailData.split(`--${boundary}`).slice(1, -1);

  let textBody = '';

  parts.forEach(part => {
    if (part.includes("Content-Type: text/plain")) { // 确保获取整个文本内容块
      const contentStartIndex = part.indexOf("\r\n\r\n") + 4;
      let content = part.substring(contentStartIndex);
      content = decodeQuotedPrintable(content); // 解码Quoted-Printable并确保UTF-8
      content = cleanText(content); // 清理文本
      textBody += content + '\n\n';
    }
  });

  return textBody;
}


function cleanText(text) {
  text = text.replace(/\r\n/g, "\n");   // 将\r\n转换为\n简化处理
  text = text.replace(/</g, '&lt;').replace(/>/g, '&gt;');  // 替换HTML特殊字符以防止HTML解析错误
  text = text.replace(/\n[ \t]*/g, "\n");  // 移除所有换行符后的空格，以及压缩多个换行符为一个
  text = text.replace(/\n+/g, '\n');  // 最后，压缩多个连续的换行符为一个
  text = text.trim();  // 移除首尾的空白字符
  return text;
}
