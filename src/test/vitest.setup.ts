/**
 * Vitest global setup — runs before every test file.
 * Configures Ant Design compatibility mocks and extends expect with DOM matchers.
 */

import "@testing-library/jest-dom/vitest";
import { vi } from "vitest";

// jsdom does not implement ResizeObserver — required by Ant Design (via @rc-component/resize-observer)
class ResizeObserverMock {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
}
vi.stubGlobal("ResizeObserver", ResizeObserverMock);

// Ant Design requires window.matchMedia for responsive/layout components
Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

window.scroll = vi.fn() as unknown as typeof window.scroll;
window.alert = vi.fn() as unknown as typeof window.alert;
