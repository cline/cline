export const sampleVue = `
<template>
  <div class="example-component">
    <h1>{{ title }}</h1>
    <nav>
      <router-link to="/">Home</router-link>
      <router-link to="/about">About</router-link>
    </nav>
    <slot name="content"></slot>
  </div>
</template>

<script>
export default {
  name: 'ExampleComponent',
  
  components: {
    ChildComponent,
    AnotherComponent,
    ThirdComponent,
    FourthComponent
  },

  props: {
    title: {
      type: String,
      required: true,
      default: 'Default Title',
      validator: function(value) {
        return value.length > 0
      }
    }
  },

  methods: {
    handleSubmit(event) {
      this.validateForm();
      this.processData();
      this.$emit('submit', this.formData);
      this.resetForm();
    }
  },

  computed: {
    fullName: {
      get() {
        return \`\${this.firstName} \${this.lastName}\`;
      },
      set(value) {
        [this.firstName, this.lastName] = value.split(' ');
        this.$emit('update:fullName', value);
      }
    }
  },

  watch: {
    searchQuery: {
      handler(newVal, oldVal) {
        this.debouncedSearch();
        this.updateHistory();
        this.logChange(newVal, oldVal);
        this.updateUI();
      },
      immediate: true,
      deep: true
    }
  },

  beforeCreate() {
    this.loadInitialState();
    this.setupEventListeners();
    this.initializePlugins();
    this.validateConfiguration();
  },

  created() {
    this.fetchData();
    this.setupWebSocket();
    this.registerGlobalEvents();
    this.initializeThirdPartyLibs();
  }
}
</script>

<style>
.example-component {
  padding: 20px;
  margin: 10px;
  border: 1px solid #ccc;
  border-radius: 4px;
}
</style>
`
