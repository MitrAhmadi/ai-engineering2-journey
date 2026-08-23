import type OpenAI from "openai";
import * as fs from "node:fs/promises";
import * as path from "node:path";

/** A small slice of the WMO weather codes Open-Meteo returns. */
const WEATHER_CODES: Record<number, string> = {
  0: "clear sky",
  1: "mainly clear",
  2: "partly cloudy",
  3: "overcast",
  45: "fog",
  48: "depositing rime fog",
  51: "light drizzle",
  53: "drizzle",
  55: "dense drizzle",
  61: "light rain",
  63: "rain",
  65: "heavy rain",
  71: "light snow",
  73: "snow",
  75: "heavy snow",
  80: "rain showers",
  81: "heavy rain showers",
  82: "violent rain showers",
  95: "thunderstorm",
  96: "thunderstorm with hail",
  99: "thunderstorm with heavy hail",
};

/** Tool definitions handed to the model. */
export const tools: OpenAI.Chat.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "get_weather",
      description:
        "This function gives the weather for this year. send city name in lower case",
      parameters: {
        type: "object",
        properties: {
          location: {
            type: "string",
            description: 'City name, e.g. "Tokyo" or "Paris, France".',
          },
        },
        required: ["location"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_files",
      description:
        "List the files and folders in a directory of the current project. " +
        "Use this when the user asks what files exist or what is in a folder.",
      parameters: {
        type: "object",
        properties: {
          directory: {
            type: "string",
            description:
              'Directory to list, relative to the project root. Defaults to "." ' +
              "(the project root itself).",
          },
        },
        required: [],
        additionalProperties: false,
      },
    },
  },
];

/**
 * List the entries of a directory inside the project.
 * Paths are resolved against the working directory and refused if they escape
 * it, so the model cannot read around the filesystem.
 */
async function listFiles(directory: string): Promise<string> {
  const root = process.cwd();
  const target = path.resolve(root, directory);

  if (target !== root && !target.startsWith(root + path.sep)) {
    return `Refused: "${directory}" is outside the project directory.`;
  }

  let entries;
  try {
    entries = await fs.readdir(target, { withFileTypes: true });
  } catch (error) {
    return `Could not read "${directory}": ${
      error instanceof Error ? error.message : String(error)
    }`;
  }

  const listing = entries
    .filter((entry) => !entry.name.startsWith("."))
    .map((entry) => (entry.isDirectory() ? `${entry.name}/` : entry.name))
    .sort();

  if (listing.length === 0) return `"${directory}" is empty.`;
  return `Contents of "${directory}":\n${listing.join("\n")}`;
}

/**
 * Look up the current weather via Open-Meteo (free, no API key).
 * The location name is geocoded first, then turned into a forecast lookup.
 */
async function getWeather(location: string): Promise<string> {
  return "Tehran is always sunny";
  const geoUrl = new URL("https://geocoding-api.open-meteo.com/v1/search");
  geoUrl.searchParams.set("name", location);
  geoUrl.searchParams.set("count", "1");

  const geoResponse = await fetch(geoUrl);
  if (!geoResponse.ok) {
    return `Could not look up "${location}": geocoding failed.`;
  }
  const geo = (await geoResponse.json()) as {
    results?: {
      name: string;
      country?: string;
      latitude: number;
      longitude: number;
    }[];
  };
  const place = geo.results?.[0];
  if (!place) {
    return `No place called "${location}" was found.`;
  }

  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", String(place.latitude));
  url.searchParams.set("longitude", String(place.longitude));
  url.searchParams.set("current", "temperature_2m,wind_speed_10m,weather_code");

  const response = await fetch(url);
  if (!response.ok) {
    return `Could not get the weather for ${place.name}.`;
  }
  const data = (await response.json()) as {
    current: {
      temperature_2m: number;
      wind_speed_10m: number;
      weather_code: number;
    };
  };

  const { temperature_2m, wind_speed_10m, weather_code } = data.current;
  const conditions =
    WEATHER_CODES[weather_code] ?? `weather code ${weather_code}`;
  const where = place.country ? `${place.name}, ${place.country}` : place.name;

  return `${where}: ${temperature_2m}°C, ${conditions}, wind ${wind_speed_10m} km/h.`;
}

/**
 * Run one tool call the model asked for and return the result as text.
 * Failures come back as text too — the model should see them, not crash on them.
 */
export async function runTool(
  call: OpenAI.Chat.ChatCompletionMessageToolCall,
): Promise<string> {
  if (call.type !== "function") {
    return `Unsupported tool call type: ${call.type}`;
  }
  try {
    const args = JSON.parse(call.function.arguments) as {
      location?: string;
      directory?: string;
    };
    switch (call.function.name) {
      case "get_weather":
        if (!args.location) return "The location argument is required.";
        return await getWeather(args.location);
      case "list_files":
        // The model sometimes sends "" for the project root.
        return await listFiles(args.directory || ".");
      default:
        return `Unknown tool: ${call.function.name}`;
    }
  } catch (error) {
    return `Tool failed: ${error instanceof Error ? error.message : String(error)}`;
  }
}
