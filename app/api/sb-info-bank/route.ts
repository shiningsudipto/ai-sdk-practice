import { openai } from "@ai-sdk/openai";
import {
  convertToModelMessages,
  stepCountIs,
  streamText,
  tool,
  UIMessage,
} from "ai";
import { z } from "zod";
import employees from "@/public/employee.json";
import aboutData from "@/public/about.json";
import faqData from "@/public/faq.json";

type Employee = {
  id: number;
  name: string;
  joinDate: string;
  phone: string;
  address: string;
  email: string;
  dob: string;
  designation: string;
  bloodGroup: string;
  emergencyContact: string;
};

type FAQ = {
  value?: string;
  question: string;
  answer: string;
};

type FAQCategory = {
  title_highlight: string;
  faqs: FAQ[];
};

const tools = {
  getEmployeeByName: tool({
    description:
      "Search for an employee by name. Returns employee details if found. Use partial name matching.",
    inputSchema: z.object({
      name: z
        .string()
        .describe("The name or partial name of the employee to search for"),
    }),
    execute: async ({ name }: { name: string }) => {
      const searchTerm = name.toLowerCase();
      const found = (employees as Employee[]).filter((emp) =>
        emp.name.toLowerCase().includes(searchTerm),
      );

      if (found.length === 0) {
        return {
          success: false,
          message: `No employee found with name matching "${name}"`,
        };
      }

      return { success: true, employees: found };
    },
  }),

  getEmployeeByDesignation: tool({
    description: "Get all employees with a specific designation/role",
    inputSchema: z.object({
      designation: z
        .string()
        .describe(
          "The job designation to filter by (e.g., 'Full-Stack Engineer', 'CTO')",
        ),
    }),
    execute: async ({ designation }: { designation: string }) => {
      const searchTerm = designation.toLowerCase();
      const found = (employees as Employee[]).filter((emp) =>
        emp.designation.toLowerCase().includes(searchTerm),
      );

      if (found.length === 0) {
        return {
          success: false,
          message: `No employees found with designation "${designation}"`,
        };
      }

      return { success: true, count: found.length, employees: found };
    },
  }),

  getAllEmployees: tool({
    description: "Get a list of all employees at StrategyByte",
    inputSchema: z.object({}),
    execute: async () => {
      const summary = (employees as Employee[]).map((emp) => ({
        name: emp.name,
        designation: emp.designation,
        email: emp.email,
      }));

      return { success: true, count: employees.length, employees: summary };
    },
  }),

  getCompanyInfo: tool({
    description:
      "Get information about StrategyByte company including description, services overview, and mission",
    inputSchema: z.object({}),
    execute: async () => {
      return {
        success: true,
        company: aboutData.company_name,
        description: aboutData.description,
        closingStatement: aboutData.closing_statement,
      };
    },
  }),

  getServices: tool({
    description:
      "Get list of services offered by StrategyByte. Can filter by service name.",
    inputSchema: z.object({
      serviceName: z
        .string()
        .optional()
        .describe(
          "Optional service name to filter (e.g., 'Website', 'SEO', 'Brand', 'Content')",
        ),
    }),
    execute: async ({ serviceName }: { serviceName?: string }) => {
      if (serviceName) {
        const searchTerm = serviceName.toLowerCase();
        const found = aboutData.services.filter(
          (service) =>
            service.title.toLowerCase().includes(searchTerm) ||
            service.description.toLowerCase().includes(searchTerm),
        );

        if (found.length === 0) {
          return {
            success: false,
            message: `No service found matching "${serviceName}"`,
          };
        }

        return { success: true, services: found };
      }

      return {
        success: true,
        intro: aboutData.services_intro,
        services: aboutData.services,
      };
    },
  }),

  searchFAQ: tool({
    description:
      "Search FAQs by keyword or question. Use this when user asks questions about services, pricing, or processes.",
    inputSchema: z.object({
      query: z
        .string()
        .describe(
          "Search term to find relevant FAQs (e.g., 'cost', 'SEO', 'brand', 'website')",
        ),
    }),
    execute: async ({ query }: { query: string }) => {
      const searchTerm = query.toLowerCase();
      const results: { category: string; question: string; answer: string }[] =
        [];

      (faqData as FAQCategory[]).forEach((category) => {
        category.faqs.forEach((faq) => {
          if (
            faq.question.toLowerCase().includes(searchTerm) ||
            faq.answer.toLowerCase().includes(searchTerm)
          ) {
            results.push({
              category: category.title_highlight,
              question: faq.question,
              answer: faq.answer,
            });
          }
        });
      });

      if (results.length === 0) {
        return {
          success: false,
          message: `No FAQs found matching "${query}"`,
        };
      }

      return { success: true, count: results.length, faqs: results };
    },
  }),

  getFAQsByCategory: tool({
    description:
      "Get all FAQs for a specific category (Marketing Agency, Content Marketing, Website Development, Brand Management)",
    inputSchema: z.object({
      category: z
        .string()
        .describe(
          "Category name: 'Marketing Agency', 'Content Marketing', 'Full-Stack Website Development', or 'Strategic Brand Management'",
        ),
    }),
    execute: async ({ category }: { category: string }) => {
      const searchTerm = category.toLowerCase();
      const found = (faqData as FAQCategory[]).find((cat) =>
        cat.title_highlight.toLowerCase().includes(searchTerm),
      );

      if (!found) {
        const categories = (faqData as FAQCategory[]).map(
          (cat) => cat.title_highlight,
        );
        return {
          success: false,
          message: `Category "${category}" not found. Available categories: ${categories.join(", ")}`,
        };
      }

      return {
        success: true,
        category: found.title_highlight,
        count: found.faqs.length,
        faqs: found.faqs,
      };
    },
  }),
};

export async function POST(req: Request) {
  try {
    const { messages }: { messages: UIMessage[] } = await req.json();
    const modelMessages = await convertToModelMessages(messages);
    const result = streamText({
      model: openai("gpt-4.1-nano"),
      system: `You are Support Assistant, the helpful assistant for StrategyByte (SB), a digital agency. You have access to tools for:
- Employee information (search by name, designation, list all)
- Company information (about, services)
- FAQs (search by keyword, filter by category)

Use the appropriate tool to answer questions.
Be concise and helpful in your responses. Introduce yourself as "Sukuna" when greeted.`,
      messages: modelMessages,
      tools,
      stopWhen: stepCountIs(2),
    });

    result.usage.then((usage) => {
      console.log("token breakdown:", {
        inputToken: usage.inputTokens,
        outputToken: usage.outputTokens,
        totalTokens: usage.totalTokens,
      });
    });

    return result.toUIMessageStreamResponse();
  } catch (error) {
    console.log("Error streaming text:", error);
    return new Response("Failed to stream text", { status: 500 });
  }
}
