/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from "next/server";
import axios from "axios";

const NEWS_THING = process.env.NEWS_THING;
const HUGGING_FACE_API_KEY = process.env.HUGGING_FACE_API_KEY;

async function fetchNews(query: string, pageSize: number = 3) {
  const url = "https://newsapi.org/v2/everything";
  const params = {
    q: query,
    apiKey: NEWS_THING,
    language: "en",
    pageSize,
  };

  try {
    const response = await axios.get(url, { params });
    if (response.status === 200) {
      return response.data.articles.map((article: any) => ({
        title: article.title,
        description: article.description || "",
        url: article.url,
      }));
    }
  } catch (error) {
    console.error("Error fetching news:", error);
  }

  return [];
}

async function summarizeArticles(articles: any[]) {
  if (articles.length === 0) {
    return "No articles found to summarize.";
  }

  const combinedText = articles
    .map((article) => `${article.title}: ${article.description}`)
    .join("\n")
    .slice(0, 1000);

  const response = await axios.post(
    "https://api-inference.huggingface.co/models/t5-small",
    { inputs: combinedText },
    {
      headers: { Authorization: `Bearer ${HUGGING_FACE_API_KEY}` },
    }
  );

  return response.data[0].summary_text;
}

async function rewriteSummary(summary: string, tone: string, style: string) {
  const prompt = `Rewrite the following in a ${tone} tone for a ${style} audience:\n${summary}`;

  const response = await axios.post(
    "https://api-inference.huggingface.co/models/google/flan-t5-base",
    { inputs: prompt },
    {
      headers: { Authorization: `Bearer ${HUGGING_FACE_API_KEY}` },
    }
  );

  return response.data[0].generated_text;
}

export async function POST(request: Request) {
  const { query, tone, style } = await request.json();

  const articles = await fetchNews(query);
  const summary = await summarizeArticles(articles);

  let finalOutput = "";
  if (summary !== "No articles found to summarize.") {
    finalOutput = await rewriteSummary(summary, tone, style);
  } else {
    finalOutput = summary;
  }

  return NextResponse.json({ content: finalOutput });
}
