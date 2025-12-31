/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from "next/server";
import axios from "axios";
import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";

const NEWS_API_KEY = process.env.NEWS_API_KEY;
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const TOGETHER_API_KEY = process.env.TOGETHER_API_KEY;

async function fetchNewsArticles(topic: string, numArticles: number = 3) {
  const url = `https://newsapi.org/v2/everything?q=${topic}&apiKey=${NEWS_API_KEY}&pageSize=${numArticles}`;
  const response = await axios.get(url);
  return response.data.articles.map((article: any) => ({
    title: article.title,
    url: article.url,
  }));
}

async function scrapeArticle(url: string): Promise<string> {
  try {
    const response = await axios.get(url);
    const dom = new JSDOM(response.data);
    const reader = new Readability(dom.window.document);
    const article = reader.parse();
    return article?.textContent || "";
  } catch (error) {
    console.error(`Failed to scrape article: ${error}`);
    return "";
  }
}

async function generateSummaryWithGroq(content: string): Promise<string> {
  // Using Llama 3.3 70B for high-quality summarization
  // - 128k token context window for long articles
  // - Production-ready model (stable and reliable)
  // - Better comprehension and summarization quality than 8B models
  const messages = [
    {
      role: "user",
      content: `Summarize the following article and list the 10 most important points, Highlight the important points in just bullet points. Don't start with anything else; just give me bullet points: ${content}`,
    },
  ];

  try {
    const response = await axios.post(
      "https://api.groq.com/openai/v1/chat/completions",
      {
        model: "llama-3.3-70b-versatile",
        messages,
        temperature: 0.5,
        max_tokens: 1024,
      },
      {
        headers: {
          Authorization: `Bearer ${GROQ_API_KEY}`,
          "Content-Type": "application/json",
        },
      }
    );

    return response.data.choices[0].message.content;
  } catch (error: any) {
    console.error("Groq API Error Details:");
    console.error("Status:", error.response?.status);
    console.error("Error Data:", JSON.stringify(error.response?.data, null, 2));
    console.error("Request Data:", JSON.stringify({ model: "llama-3.3-70b-versatile", messages }, null, 2));
    throw error;
  }
}

async function generateTextPost(
  articlesData: any[],
  platform: string,
  topic: string
): Promise<string> {
  const formattedArticles = articlesData
    .map(
      (article) =>
        `Title: ${article.title}\nURL: ${article.url}\nSummary: ${article.summary}`
    )
    .join("\n\n");

  const command = `I need a post for the ${platform}. Use the tone and wording that align with the professionalism and context of the platform. I will provide you with a few summaries of articles, and you need to incorporate content from those articles into the post.

  It is very important to mention the name and URL of the references for each part taken from the articles.

  The post must directly start with the content—no need to include introductory phrases like "Here's the post" or anything extra at the end. However, ensure the post includes at least 5 relevant hashtags in line with the platform.

  The post can contain emojis, but avoid using asterisks for bold text. The generated post must be clean and professional.

  The post should primarily focus on the title provided by the user but must incorporate data from the provided articles. It is absolutely necessary to base the post on the data from these articles.

  Here are the articles for the post on the topic of ${topic}. Write the post while keeping these articles in mind also add a title for the post as well: ${formattedArticles}`;

  try {
    const response = await axios.post(
      "https://api.groq.com/openai/v1/chat/completions",
      {
        model: "llama-3.3-70b-versatile",
        messages: [{ role: "user", content: command }],
        max_tokens: 1500,
        temperature: 0.7,
      },
      {
        headers: {
          Authorization: `Bearer ${GROQ_API_KEY}`,
          "Content-Type": "application/json",
        },
      }
    );

    return response.data.choices[0].message.content;
  } catch (error: any) {
    console.error("Groq API Error (Text Post Generation):");
    console.error("Status:", error.response?.status);
    console.error("Error Data:", JSON.stringify(error.response?.data, null, 2));
    throw error;
  }
}

async function generateImage(
  postContent: string,
  platform: string,
  topic: string
): Promise<string | null> {
  const prompt = `I need a highly realistic, detailed, and professional-quality image for a post on the platform ${platform}. The topic of the post is ${topic}, and its content focuses on ${postContent}. The image should be visually compelling, unique, and perfectly tailored to align with the post's theme, subject matter, and intended tone. It should resonate with the audience of the platform, enhancing the post's message while maintaining an authentic and realistic aesthetic. The image must directly reflect the essence of the topic and content, ensuring relevance and emotional impact.`;

  try {
    const response = await axios.post(
      "https://api.together.xyz/v1/images/generations",
      {
        prompt,
        model: "black-forest-labs/FLUX.1-dev",
        width: 1024,
        height: 768,
        steps: 28,
        n: 1,
        response_format: "b64_json",
      },
      {
        headers: {
          Authorization: `Bearer ${TOGETHER_API_KEY}`,
          "Content-Type": "application/json",
        },
      }
    );

    return response.data.data[0].b64_json;
  } catch (error: any) {
    console.error("Together.xyz Image Generation Error:");
    console.error("Status:", error.response?.status);
    console.error("Error:", error.response?.data || error.message);
    console.warn("Image generation failed - continuing without image");
    return null;
  }
}

export async function POST(request: Request) {
  const { topic, platform, options } = await request.json();

  try {
    const articles = await fetchNewsArticles(topic);
    const articlesData = await Promise.all(
      articles.map(async (article: any) => {
        const content = await scrapeArticle(article.url);
        const summary = await generateSummaryWithGroq(content);
        return { ...article, summary };
      })
    );

    const textPost = await generateTextPost(articlesData, platform, topic);
    let imageUrl = null;

    if (options.image) {
      const imageBase64 = await generateImage(textPost, platform, topic);
      if (imageBase64) {
        imageUrl = `data:image/png;base64,${imageBase64}`;
      }
    }

    return NextResponse.json({ textPost, imageUrl });
  } catch (error) {
    console.error("Error generating content:", error);
    return NextResponse.json(
      { error: "Failed to generate content" },
      { status: 500 }
    );
  }
}
