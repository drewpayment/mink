export interface PreToolUseInput {
  tool_name: string;
  tool_input: {
    file_path?: string;
  };
}

export interface PostToolUseInput {
  tool_name: string;
  tool_input: {
    file_path?: string;
  };
  tool_output?: {
    content?: string;
    [key: string]: unknown;
  };
}
