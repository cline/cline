export default String.raw`
<%# Multi-line comment block explaining 
    template purpose and usage
    across multiple lines %>

<%# Function definition block %>
<% def complex_helper(param1, param2)
     result = process_data(param1)
     format_output(result, param2)
   end %>

<%# Class definition block %>
<% class TemplateHelper
     def initialize(options)
       @options = options
     end

     def render_content
       process_template_data
     end
   end %>

<%# Module definition block %>
<% module TemplateUtils
     def self.format_data(input)
       sanitize(input)
     end

     def self.validate_input(data)
       check_format(data)
     end
   end %>

<%# Control structure with nested blocks %>
<div class="container">
  <% if user.authenticated? %>
    <h1>Welcome, <%= user.name %></h1>
    
    <% user.posts.each do |post| %>
      <article class="post">
        <h2><%= post.title %></h2>
        <div class="content">
          <%= post.content %>
        </div>
        
        <% if post.has_comments? %>
          <section class="comments">
            <% post.comments.each do |comment| %>
              <div class="comment">
                <%= comment.body %>
              </div>
            <% end %>
          </section>
        <% end %>
      </article>
    <% end %>
  <% else %>
    <h1>Please log in</h1>
  <% end %>
</div>

<%# Helper method definition %>
<% def render_navigation(items)
     items.map do |item| %>
       <li class="nav-item">
         <%= link_to item.name, item.path %>
       </li>
     <% end
   end %>

<%# Complex layout structure %>
<% content_for :header do %>
  <header>
    <nav>
      <ul>
        <%= render_navigation(@nav_items) %>
      </ul>
    </nav>
  </header>
<% end %>

<%# Yield block with fallback %>
<% content_for :main do %>
  <main>
    <%= yield || render('default_content') %>
  </main>
<% end %>
`
