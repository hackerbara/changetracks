declare module 'markdown-it' {
    interface MarkdownIt {
        use(plugin: (...args: any[]) => void, ...options: any[]): MarkdownIt;
        render(src: string, env?: any): string;
    }
    interface MarkdownItConstructor {
        new(options?: Record<string, unknown>): MarkdownIt;
        (options?: Record<string, unknown>): MarkdownIt;
    }
    const MarkdownIt: MarkdownItConstructor;
    export = MarkdownIt;
}
