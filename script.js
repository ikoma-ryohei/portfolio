/* Nav collapse/expand + menu overlay — ported from yoichiochiai.com theme behavior */

(function () {
  "use strict";

  var EASE = "cubic-bezier(0.77, 0, 0.175, 1)";

  /* ---------- Sidebar nav: collapse into dot on scroll ---------- */

  var trigger = document.querySelector(".header__nav-trigger");
  var nav = document.querySelector(".header__nav");
  var items = Array.prototype.slice.call(
    document.querySelectorAll(".header__nav__list > li")
  );

  items.forEach(function (li) {
    li.style.transition = "opacity 500ms " + EASE;
  });

  function onNavLeave() {
    collapse();
  }

  /* Fade items out bottom-to-top (50ms stagger), then swap nav for the dot */
  function collapse() {
    trigger.removeEventListener("mouseenter", expand);
    nav.removeEventListener("mouseleave", onNavLeave);

    var fades = items
      .slice()
      .reverse()
      .map(function (li, i) {
        return new Promise(function (resolve) {
          li.style.transitionDelay = 50 * i + "ms";
          li.style.opacity = "0";
          setTimeout(resolve, 50 * i + 500);
        });
      });

    return Promise.all(fades).then(function () {
      nav.style.display = "none";
      trigger.classList.add("is-visible");
      trigger.addEventListener("mouseenter", expand, { once: true });
    });
  }

  /* Hide the dot, fade items back in top-to-bottom */
  function expand() {
    trigger.removeEventListener("mouseenter", expand);
    nav.removeEventListener("mouseleave", onNavLeave);

    trigger.classList.remove("is-visible");
    nav.style.display = "";

    if (window.pageYOffset >= 10) {
      nav.addEventListener("mouseleave", onNavLeave, { once: true });
    }

    var fades = items.map(function (li, i) {
      return new Promise(function (resolve) {
        li.style.transitionDelay = 50 * i + "ms";
        li.style.opacity = "1";
        setTimeout(resolve, 50 * i + 500);
      });
    });

    return Promise.all(fades);
  }

  var isCollapsed = false;

  function onScroll() {
    if (window.pageYOffset < 10 && isCollapsed) {
      isCollapsed = false;
      expand();
      return;
    }
    if (window.pageYOffset >= 10 && !isCollapsed) {
      isCollapsed = true;
      collapse();
    }
  }

  if (trigger && nav && items.length) {
    window.addEventListener("scroll", onScroll);
    onScroll();
  }

  /* ---------- Fullscreen menu overlay ---------- */

  var menu = document.querySelector(".menu");
  var menuOpenButton = document.querySelector(".header__button");
  var menuCloseButton = document.querySelector(".menu__button");

  function openMenu() {
    menu.classList.add("is-open");
    void menu.offsetWidth; /* flush display:block before starting the fade */
    menu.classList.add("is-shown");
  }

  function closeMenu() {
    menu.classList.remove("is-shown");
    setTimeout(function () {
      menu.classList.remove("is-open");
    }, 500);
  }

  if (menu && menuOpenButton && menuCloseButton) {
    menuOpenButton.addEventListener("click", openMenu);
    menuCloseButton.addEventListener("click", closeMenu);
  }

  /* ---------- Smooth anchor scroll (500ms easeInOutQuart) ---------- */

  var header = document.querySelector(".header");

  function easeInOutQuart(t) {
    return t < 0.5 ? 8 * t * t * t * t : 1 - Math.pow(-2 * t + 2, 4) / 2;
  }

  function scrollToTarget(targetY) {
    var startY = window.pageYOffset;
    var diff = targetY - startY;
    var start = null;
    var DURATION = 500;

    function step(ts) {
      if (start === null) start = ts;
      var t = Math.min((ts - start) / DURATION, 1);
      window.scrollTo(0, startY + diff * easeInOutQuart(t));
      if (t < 1) requestAnimationFrame(step);
    }

    requestAnimationFrame(step);
  }

  document.querySelectorAll('a[href^="#"]').forEach(function (link) {
    link.addEventListener("click", function (e) {
      e.preventDefault();

      var href = link.getAttribute("href");
      var target =
        href === "#" || href === "" ? document.documentElement : document.querySelector(href);
      if (!target) return;

      if (menu && menu.classList.contains("is-open")) {
        closeMenu();
      }

      var top =
        target === document.documentElement
          ? 0
          : target.getBoundingClientRect().top + window.pageYOffset - header.offsetHeight;
      scrollToTarget(Math.max(top, 0));
    });
  });
})();
