const { IgApiClient, IgCheckpointError } = require('instagram-private-api');
const { ChatGoogleGenerativeAI } = require('@langchain/google-genai');
const { ChatPromptTemplate } = require('@langchain/core/prompts');

require('dotenv').config();

const ig = new IgApiClient();
let lastMessageTimestamp = 0;
let processedMessages = new Set(); // Set to keep track of processed message IDs

const delayBeforeProcessing = 5000; // 5 seconds delay before processing
const timeWindow = 60000; // 1 minute time window to filter messages

function randomDelay(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

async function login() {
  ig.state.generateDevice(process.env.INSTAGRAM_USERNAME);
  try {
    await ig.account.login(process.env.INSTAGRAM_USERNAME, process.env.INSTAGRAM_PASSWORD);
    
    // After login, ensure you get the user ID
    const currentUser = await ig.account.currentUser();
    ig.state.cookieUserId = currentUser.pk; // Set bot's user ID
  } catch (e) {
    if (e instanceof IgCheckpointError) {
      console.log('Checkpoint error. Please go to Instagram.com to verify your account.');
      process.exit(1); // Exit the script if checkpoint error occurs
    } else {
      throw e;
    }
  }
}

async function initializeLastMessageTimestamp() {
  const inbox = ig.feed.directInbox();
  const threads = await inbox.items();

  if (threads.length > 0) {
    const messages = threads.flatMap(thread => thread.items);
    if (messages.length > 0) {
      lastMessageTimestamp = Math.max(...messages.map(message => message.timestamp));
    }
  }
}

async function listenForMessages() {
  const inbox = ig.feed.directInbox();
  const threads = await inbox.items();
  
  // Delay to avoid processing messages too quickly
  await new Promise(resolve => setTimeout(resolve, delayBeforeProcessing));

  const currentTime = Date.now();

  for (let thread of threads) {
    for (let message of thread.items) {
      if (message.item_type === 'text' &&
          message.timestamp > lastMessageTimestamp &&
          message.timestamp > (currentTime - timeWindow) &&
          message.user_id !== ig.state.cookieUserId && // Ensure it's not the bot's message
          !processedMessages.has(message.item_id)) { // Ensure it's not processed before

        console.log(`Received message: ${message.text} from ${thread.thread_title}`);

        const responseText = await getResponseFromGemini(message.text);
        await respondToMessage(thread.thread_id, responseText);

        processedMessages.add(message.item_id); // Mark message as processed
        lastMessageTimestamp = message.timestamp; // Update last processed timestamp
      }
    }
  }
}

async function getResponseFromGemini(text) {
  const model = new ChatGoogleGenerativeAI({
    model: "gemini-pro",
    apiKey: process.env.GEMINI_API_KEY,
    maxOutputTokens: 20
  });

  const prompt = ChatPromptTemplate.fromMessages([
    ["system", "from now your name is Suma.GPT and you are developed by ratnadeep and answer question based on the INPUT"],
    ["user", "INPUT:{input}"]
  ]);

  const chain = prompt.pipe(model);

  try {
    const response = await chain.invoke({ input: text });
    console.log(response.content);
    return response.content;
  } catch (error) {
    console.error('Error getting response from Gemini:', error);
    return 'Sorry, I couldn\'t process your request.';
  }
}

async function respondToMessage(threadId, response) {
  await new Promise(resolve => setTimeout(resolve, randomDelay(2000, 5000))); // Random delay between 2 and 5 seconds
  await ig.entity.directThread(threadId).broadcastText(response);
}

async function startBot() {
  await login();
  console.log('Logged in successfully!');

  await initializeLastMessageTimestamp();
  console.log('Initialized last message timestamp.');

  setInterval(listenForMessages, randomDelay(9000, 11000)); // Check for new messages every 9-11 seconds
}

startBot().catch(console.error);
