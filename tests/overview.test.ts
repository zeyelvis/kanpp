import { describe, expect, it } from "vitest";
import { bestSynopsis, cleanSynopsis } from "@/lib/ingest/overview";

const PLOT = "在发生暴力冲突的夜晚，一名救护车司机得知女儿与极端组织有牵连，事情很快失控，他必须在天亮前做出选择。";

describe("synopsis cleaning", () => {
  it("strips labels and converts to simplified", () => {
    expect(cleanSynopsis(`剧情简介：${PLOT}`)).toBe(PLOT);
    expect(cleanSynopsis("一名救護車司機得知女兒與極端組織有牽連，事情很快失控，他必須在天亮前做出選擇。")).toContain("救护车司机");
  });
  it("rejects promotion, junk and short text", () => {
    expect(cleanSynopsis(`${PLOT}更多资源请加QQ群123456`)).toBeNull();
    expect(cleanSynopsis(`${PLOT} 访问 www.example.com`)).toBeNull();
    expect(cleanSynopsis("太短了")).toBeNull();
    expect(cleanSynopsis("A plot summary written only in English, long enough to pass.")).toBeNull();
  });
  it("cuts long text at a sentence end", () => {
    const long = `${PLOT}`.repeat(20);
    const out = cleanSynopsis(long)!;
    expect(out.length).toBeLessThanOrEqual(800);
    expect(out.endsWith("。")).toBe(true);
  });
  it("picks the fullest usable candidate", () => {
    expect(bestSynopsis(["一句话简介，内容不够但也超过二十个字符的长度了吧。", PLOT, null, "加微信看更多"])).toBe(PLOT);
  });
});
