import { describe, expect, it } from "vitest"
import { attachmentsFromParts, headerField, normalizeCid, parseAddressHeader, toSnippet } from "./parse"

describe("headerField", () => {
  it("抽取字段并展开折行", () => {
    const raw = "Subject: hello\r\n\tworld\r\nTo: a@b.com\r\n"
    expect(headerField(raw, "subject")).toBe("hello world")
    expect(headerField(raw, "To")).toBe("a@b.com")
    expect(headerField(raw, "missing")).toBe("")
  })
})

describe("parseAddressHeader", () => {
  it("解码 RFC2047 姓名并保留地址", () => {
    expect(parseAddressHeader("=?UTF-8?B?5byg5LiJ?= <zhang@example.com>, li@example.com")).toEqual([
      { name: "张三", address: "zhang@example.com" },
      { name: "", address: "li@example.com" }
    ])
  })

  it("引号里的逗号不算分隔符", () => {
    expect(parseAddressHeader('"Doe, John" <john@example.com>')).toEqual([
      { name: "Doe, John", address: "john@example.com" }
    ])
  })
})

describe("normalizeCid", () => {
  it("去掉尖括号与空白", () => {
    expect(normalizeCid("  <abc@x> ")).toBe("abc@x")
    expect(normalizeCid("abc@x")).toBe("abc@x")
  })
})

describe("toSnippet", () => {
  it("去标签、压空白并按长度截断", () => {
    expect(toSnippet("<p>hello <b>world</b></p>\r\n<p>second</p>")).toBe("hello world second")
    expect(toSnippet("a".repeat(10), 5)).toBe("aaaaa…")
  })
})

describe("attachmentsFromParts", () => {
  it("base64 尺寸按行折算（40MB 不再显示成 41.1MB）", () => {
    const [attachment] = attachmentsFromParts(
      [{ part: "2", filename: "a.bin", mime: "application/octet-stream", encoding: "base64", size: 1000 }],
      "msg-1"
    )
    // ceil(1000/78)=13 行，每行折掉 2 字节 CRLF：(1000-26)*3/4 = 730.5 → 731
    expect(attachment.size).toBe(731)
    expect(attachment.part).toBe("2")
    expect(attachment.messageId).toBe("msg-1")
  })

  it("非 base64 不折算", () => {
    const [attachment] = attachmentsFromParts(
      [{ part: "3", filename: "b.txt", mime: "text/plain", encoding: "7bit", size: 1000 }],
      "msg-1"
    )
    expect(attachment.size).toBe(1000)
  })
})
