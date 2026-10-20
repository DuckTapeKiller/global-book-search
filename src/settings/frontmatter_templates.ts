// Localized default frontmatter templates offered by the "Language" menu in
// settings. Kept in its own module (no Obsidian imports) so the templates can be
// unit-tested and extended without pulling in the settings UI.

export const FRONTMATTER_TEMPLATES = {
  Spanish: `---
Título: {{title}}
Título original: {{originalTitle}}
Autor: {{author}}
Traductor: {{translator}}
Prólogo: ""
Resumen: "{{description}}"
Páginas: "{{totalPage}}"
Editorial: {{publisher}}
Géneros: {{categories}}
isbn 10: "{{isbn10}}"
isbn 13: "{{isbn13}}"
ASIN: {{asin}}
Fecha de publicación: {{publishDate}}
Fecha de lectura: 
Portada: "{{localCoverImage}}"
Enlace: {{link}}
tags: {{tags}}
Leído: false
---`,
  English: `---
Title: {{title}}
Original title: {{originalTitle}}
Author: {{author}}
Translator: {{translator}}
Prologue: ""
Description: "{{description}}"
Total Pages: "{{totalPage}}"
Publisher: {{publisher}}
Categories: {{categories}}
isbn 10: "{{isbn10}}"
isbn 13: "{{isbn13}}"
Asin: {{asin}}
Published: {{publishDate}}
Date read:
Cover: "{{localCoverImage}}"
Link: {{link}}
Tags: {{tags}}
Read: false
---`,
  French: `---
Titre: {{title}}
Titre original: {{originalTitle}}
Auteur: {{author}}
Traducteur: {{translator}}
Prologue: ""
Description: "{{description}}"
Nombre total de pages: "{{totalPage}}"
Éditeur: {{publisher}}
Catégories: {{categories}}
isbn 10: "{{isbn10}}"
isbn 13: "{{isbn13}}"
Asin: {{asin}}
Publié: {{publishDate}}
Date de lecture: 
Couverture: "{{localCoverImage}}"
Lien: {{link}}
tags: {{tags}}
Lu: false
---`,
  German: `---
Titel: {{title}}
Originaltitel: {{originalTitle}}
Autor: {{author}}
Übersetzer: {{translator}}
Prolog: ""
Beschreibung: "{{description}}"
Gesamtseitenzahl: "{{totalPage}}"
Verlag: {{publisher}}
Kategorien: {{categories}}
isbn 10: "{{isbn10}}"
isbn 13: "{{isbn13}}"
Asin: {{asin}}
Veröffentlicht: {{publishDate}}
Lesedatum: 
Cover: "{{localCoverImage}}"
Link: {{link}}
tags: {{tags}}
Gelesen: false
---`,
  Italian: `---
Titolo: {{title}}
Titolo originale: {{originalTitle}}
Autore: {{author}}
Traduttore: {{translator}}
Prologo: ""
Descrizione: "{{description}}"
Pagine totali: "{{totalPage}}"
Editore: {{publisher}}
Categorie: {{categories}}
isbn 10: "{{isbn10}}"
isbn 13: "{{isbn13}}"
Asin: {{asin}}
Pubblicato: {{publishDate}}
Data di lettura: 
Copertina: "{{localCoverImage}}"
Link: {{link}}
tags: {{tags}}
Letto: false
---`,
  Portuguese: `---
Título: {{title}}
Título original: {{originalTitle}}
Autor: {{author}}
Tradutor: {{translator}}
Prólogo: ""
Descrição: "{{description}}"
Total de páginas: "{{totalPage}}"
Editora: {{publisher}}
Categorias: {{categories}}
isbn 10: "{{isbn10}}"
isbn 13: "{{isbn13}}"
Asin: {{asin}}
Publicado: {{publishDate}}
Data de leitura: 
Capa: "{{localCoverImage}}"
Link: {{link}}
tags: {{tags}}
Lido: false
---`,
  Dutch: `---
Titel: {{title}}
Oorspronkelijke titel: {{originalTitle}}
Auteur: {{author}}
Vertaler: {{translator}}
Proloog: ""
Beschrijving: "{{description}}"
Totaal aantal pagina's: "{{totalPage}}"
Uitgever: {{publisher}}
Categorieën: {{categories}}
isbn 10: "{{isbn10}}"
isbn 13: "{{isbn13}}"
Asin: {{asin}}
Gepubliceerd: {{publishDate}}
Gelezen op: 
Omslag: "{{localCoverImage}}"
Link: {{link}}
tags: {{tags}}
Gelezen: false
---`,
  Russian: `---
Название: {{title}}
Оригинальное название: {{originalTitle}}
Автор: {{author}}
Переводчик: {{translator}}
Пролог: ""
Описание: "{{description}}"
Всего страниц: "{{totalPage}}"
Издатель: {{publisher}}
Категории: {{categories}}
isbn 10: "{{isbn10}}"
isbn 13: "{{isbn13}}"
Asin: {{asin}}
Опубликовано: {{publishDate}}
Дата прочтения: 
Обложка: "{{localCoverImage}}"
Ссылка: {{link}}
tags: {{tags}}
Прочитано: false
---`,
  "Simplified Chinese": `---
标题: {{title}}
原标题: {{originalTitle}}
作者: {{author}}
译者: {{translator}}
序言: ""
描述: "{{description}}"
总页数: "{{totalPage}}"
出版社: {{publisher}}
分类: {{categories}}
isbn 10: "{{isbn10}}"
isbn 13: "{{isbn13}}"
Asin: {{asin}}
出版日期: {{publishDate}}
阅读日期: 
封面: "{{localCoverImage}}"
链接: {{link}}
tags: {{tags}}
已读: false
---`,
  Japanese: `---
タイトル: {{title}}
原題: {{originalTitle}}
著者: {{author}}
翻訳者: {{translator}}
プロローグ: ""
説明: "{{description}}"
総ページ数: "{{totalPage}}"
出版社: {{publisher}}
カテゴリ: {{categories}}
isbn 10: "{{isbn10}}"
isbn 13: "{{isbn13}}"
Asin: {{asin}}
出版日: {{publishDate}}
読了日: 
表紙: "{{localCoverImage}}"
リンク: {{link}}
tags: {{tags}}
読了: false
---`,
  Korean: `---
제목: {{title}}
원제: {{originalTitle}}
저자: {{author}}
번역가: {{translator}}
프롤로그: ""
설명: "{{description}}"
총 페이지 수: "{{totalPage}}"
출판사: "{{publisher}}"
카테고리: "{{categories}}"
isbn 10: "{{isbn10}}"
isbn 13: "{{isbn13}}"
Asin: "{{asin}}"
출판일: "{{publishDate}}"
읽은 날짜: 
표지: "{{localCoverImage}}"
링크: "{{link}}"
tags: {{tags}}
읽음: false
---`,
  Arabic: `---
العنوان: {{title}}
العنوان الأصلي: {{originalTitle}}
المؤلف: {{author}}
المترجم: {{translator}}
مقدمة: ""
الوصف: "{{description}}"
عدد الصفحات: "{{totalPage}}"
الناشر: {{publisher}}
التصنيفات: {{categories}}
isbn 10: "{{isbn10}}"
isbn 13: "{{isbn13}}"
Asin: {{asin}}
تاريخ النشر: {{publishDate}}
تاريخ القراءة: 
الغلاف: "{{localCoverImage}}"
الرابط: {{link}}
tags: {{tags}}
مقروء: false
---`,
};

export type FrontmatterTemplateName = keyof typeof FRONTMATTER_TEMPLATES;
